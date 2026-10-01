#include "netnyahoo/core/nn_context_menu.h"

#import <AppKit/AppKit.h>

#include <string>
#include <vector>

#include "base/functional/bind.h"
#include "base/memory/weak_ptr.h"
#include "base/strings/sys_string_conversions.h"
#include "chrome/browser/renderer_context_menu/render_view_context_menu.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/cocoa/renderer_context_menu/render_view_context_menu_mac_cocoa.h"
#include "chrome/browser/ui/tab_contents/chrome_web_contents_menu_helper.h"
#include "chrome/browser/ui/tab_contents/chrome_web_contents_view_delegate.h"
#include "components/tabs/public/tab_interface.h"
#include "content/public/browser/browser_context.h"
#include "ui/base/clipboard/clipboard.h"
#include "ui/base/clipboard/clipboard_format_type.h"
#include "ui/base/data_transfer_policy/data_transfer_endpoint.h"
#include "chrome/browser/ui/views/tab_contents/chrome_web_contents_view_delegate_views_mac.h"
#include "chrome/app/chrome_command_ids.h"
#include "content/public/browser/context_menu_params.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/render_widget_host_view.h"
#include "content/public/browser/web_contents.h"
#include "netnyahoo/core/nn_browser.h"
#import "netnyahoo/core/nncore_internal.h"
#include "ui/events/event_constants.h"

namespace nncore {

namespace {

// The host's items take ids at the end of Chrome's page-custom range (pages no longer add
// custom items; Pepper plugins did).
constexpr int kHostFirst = IDC_CONTENT_CONTEXT_CUSTOM_FIRST + 900;
constexpr int kHostLast = IDC_CONTENT_CONTEXT_CUSTOM_FIRST + 999;

NNCoreTab* TabOf(content::WebContents* contents) {
  BrowserWindowInterface* browser =
      contents ? GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(contents)
               : nullptr;
  return browser && WindowHost::ForBrowser(browser)
             ? TabBridge::GetOrCreate(contents)->tab()
             : nil;
}

class NNContextMenu : public RenderViewContextMenuMacCocoa {
 public:
  using RenderViewContextMenuMacCocoa::RenderViewContextMenuMacCocoa;

  // After Init(): the host's items for a selection.
  void AddHostItems() {
    const std::u16string& selection = params().selection_text;
    NNCoreTab* tab = TabOf(source_web_contents_);
    id<NNCoreTabDelegate> delegate = tab.delegate;
    if (selection.empty() || params().is_editable ||
        ![delegate respondsToSelector:@selector(tab:contextMenuItemsForSelection:)]) {
      return;
    }
    NSArray<NSDictionary*>* items =
        [delegate tab:tab
            contextMenuItemsForSelection:base::SysUTF16ToNSString(selection)];
    // After Chrome's Copy, as CEF placed them.
    std::optional<size_t> copy =
        menu_model_.GetIndexOfCommandId(IDC_CONTENT_CONTEXT_COPY);
    size_t at = copy ? *copy + 1 : menu_model_.GetItemCount();
    for (NSDictionary* item in items) {
      NSString* item_id = [item[@"id"] isKindOfClass:NSString.class] ? item[@"id"] : nil;
      NSString* title = [item[@"title"] isKindOfClass:NSString.class] ? item[@"title"] : nil;
      const int command = kHostFirst + static_cast<int>(host_items_.size());
      if (!item_id || !title || command > kHostLast) {
        continue;
      }
      host_items_.push_back(base::SysNSStringToUTF8(item_id));
      // "replaces": "search": in place of Chrome's own search item(s).
      size_t place = at;
      bool replaced = false;
      if ([item[@"replaces"] isEqual:@"search"]) {
        for (int chrome_id : {IDC_CONTENT_CONTEXT_SEARCHWEBFOR,
                              IDC_CONTENT_CONTEXT_SEARCHWEBFORNEWTAB}) {
          if (std::optional<size_t> index = menu_model_.GetIndexOfCommandId(chrome_id)) {
            if (!replaced) {
              place = *index;
            }
            menu_model_.RemoveItemAt(*index);
            replaced = true;
            if (*index < at) {
              --at;
            }
          }
        }
      }
      menu_model_.InsertItemAt(place, command, base::SysNSStringToUTF16(title));
      if (!replaced || place < at) {
        ++at;
      }
    }
  }

 protected:
  bool IsCommandIdEnabled(int command_id) const override {
    if (command_id >= kHostFirst && command_id <= kHostLast) {
      return true;
    }
    return RenderViewContextMenuMacCocoa::IsCommandIdEnabled(command_id);
  }

  void ExecuteCommand(int command_id, int event_flags) override {
    const size_t index = command_id - kHostFirst;
    if (command_id < kHostFirst || command_id > kHostLast ||
        index >= host_items_.size()) {
      RenderViewContextMenuMacCocoa::ExecuteCommand(command_id, event_flags);
      return;
    }
    NNCoreTab* tab = TabOf(source_web_contents_);
    id<NNCoreTabDelegate> delegate = tab.delegate;
    if ([delegate respondsToSelector:@selector(tab:contextMenuCommand:text:modifiers:)]) {
      [delegate tab:tab
          contextMenuCommand:base::SysUTF8ToNSString(host_items_[index])
                        text:base::SysUTF16ToNSString(params().selection_text)
                   modifiers:@{
                     @"metaKey" : @((event_flags & ui::EF_COMMAND_DOWN) != 0),
                     @"shiftKey" : @((event_flags & ui::EF_SHIFT_DOWN) != 0),
                     @"altKey" : @((event_flags & ui::EF_ALT_DOWN) != 0),
                   }];
    }
  }

 private:
  std::vector<std::string> host_items_;
};

class NNViewDelegate : public ChromeWebContentsViewDelegateViewsMac {
 public:
  explicit NNViewDelegate(content::WebContents* contents)
      : ChromeWebContentsViewDelegateViewsMac(contents), contents_(contents) {}

  std::unique_ptr<RenderViewContextMenuBase> BuildMenu(
      content::RenderFrameHost& render_frame_host,
      const content::ContextMenuParams& params) override {
    content::RenderWidgetHostView* view = contents_->GetRenderWidgetHostView();
    if (!TabOf(contents_) || !view) {
      return ChromeWebContentsViewDelegateViewsMac::BuildMenu(render_frame_host,
                                                              params);
    }
    // Chrome's menu for the page, with the host's items. Paste follows the clipboard as
    // BuildMenuAsync last read it (Chrome's view delegate keeps its own flags private).
    auto menu = std::make_unique<NNContextMenu>(
        render_frame_host, params, paste_enabled_, paste_and_match_style_enabled_,
        view->GetNativeView().GetNativeNSView());
    menu->Init();
    menu->AddHostItems();
    return menu;
  }

  // Chrome's own sequence (ChromeWebContentsViewDelegateViews::BuildMenuAsync): the
  // clipboard's types decide Paste, plain text Paste and Match Style; then BuildMenu.
  void BuildMenuAsync(
      content::RenderFrameHost& render_frame_host,
      const content::ContextMenuParams& params,
      base::OnceCallback<void(std::unique_ptr<RenderViewContextMenuBase>)> callback)
      override {
    if (!TabOf(contents_)) {
      ChromeWebContentsViewDelegateViewsMac::BuildMenuAsync(render_frame_host, params,
                                                            std::move(callback));
      return;
    }
    // As Chrome's Mac delegate: a click doesn't activate the WebContents on the Mac.
    tabs::TabInterface* tab_interface = tabs::TabInterface::MaybeGetFromContents(contents_);
    if (tab_interface && !tab_interface->IsActivated()) {
      contents_->Focus();
    }
    std::optional<ui::DataTransferEndpoint> data_dst;
    if (params.page_url.is_valid()) {
      data_dst.emplace(params.page_url,
                       ui::DataTransferEndpointOptions{
                           .notify_if_restricted = false,
                           .off_the_record =
                               contents_->GetBrowserContext()->IsOffTheRecord(),
                       });
    }
    ui::Clipboard::GetForCurrentThread()->ReadAvailableTypes(
        ui::ClipboardBuffer::kCopyPaste, data_dst,
        base::BindOnce(&NNViewDelegate::OnReadAvailableTypes, weak_factory_.GetWeakPtr(),
                       render_frame_host.GetGlobalId(),
                       AddContextMenuParamsPropertiesFromPreferences(contents_, params),
                       data_dst, std::move(callback)));
  }

 private:
  void OnReadAvailableTypes(
      content::GlobalRenderFrameHostId frame_id,
      const content::ContextMenuParams& params,
      std::optional<ui::DataTransferEndpoint> data_dst,
      base::OnceCallback<void(std::unique_ptr<RenderViewContextMenuBase>)> callback,
      std::vector<std::u16string> types) {
    paste_enabled_ = !types.empty();
    ui::Clipboard::GetForCurrentThread()->GetAllAvailableFormats(
        ui::ClipboardBuffer::kCopyPaste, std::move(data_dst),
        base::BindOnce(&NNViewDelegate::OnGetAllAvailableFormats,
                       weak_factory_.GetWeakPtr(), frame_id, params, std::move(callback)));
  }

  void OnGetAllAvailableFormats(
      content::GlobalRenderFrameHostId frame_id,
      const content::ContextMenuParams& params,
      base::OnceCallback<void(std::unique_ptr<RenderViewContextMenuBase>)> callback,
      base::flat_set<ui::ClipboardFormatType> formats) {
    paste_and_match_style_enabled_ =
        formats.contains(ui::ClipboardFormatType::PlainTextType());
    content::RenderFrameHost* frame = content::RenderFrameHost::FromID(frame_id);
    if (!frame) {
      std::move(callback).Run(nullptr);
      return;
    }
    std::move(callback).Run(BuildMenu(*frame, params));
  }

  raw_ptr<content::WebContents> contents_;
  bool paste_enabled_ = false;
  bool paste_and_match_style_enabled_ = false;
  base::WeakPtrFactory<NNViewDelegate> weak_factory_{this};
};

}  // namespace

std::unique_ptr<content::WebContentsViewDelegate> CreateViewDelegate(
    content::WebContents* contents) {
  return std::make_unique<NNViewDelegate>(contents);
}

void InstallContextMenuShowHandler() {
  if (!getenv("NETNYAHOO_BACKGROUND")) {
    return;
  }
  RenderViewContextMenu::RegisterMenuShowHandlerCallback(
      base::BindRepeating([](RenderViewContextMenu* menu) {
        NNCoreTab* tab = TabOf(menu->GetWebContents());
        id<NNCoreTabDelegate> delegate = tab.delegate;
        if (![delegate respondsToSelector:@selector(tab:didShowContextMenu:)]) {
          return false;
        }
        NSMutableArray* items = [NSMutableArray array];
        const ui::SimpleMenuModel& model = menu->menu_model();
        for (size_t i = 0; i < model.GetItemCount(); ++i) {
          [items addObject:@{
            @"id" : @(model.GetCommandIdAt(i)),
            @"label" : base::SysUTF16ToNSString(model.GetLabelAt(i)),
            @"enabled" : @(model.IsEnabledAt(i)),
            @"separator" : @(model.GetTypeAt(i) == ui::MenuModel::TYPE_SEPARATOR),
          }];
        }
        [delegate tab:tab didShowContextMenu:items];
        // Background mode: logged, not shown; closed at once for the page (as a dismissal).
        menu->MenuClosed(const_cast<ui::SimpleMenuModel*>(&model));
        return true;
      }));
}

}  // namespace nncore
