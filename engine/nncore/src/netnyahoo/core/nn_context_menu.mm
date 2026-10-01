#include "netnyahoo/core/nn_context_menu.h"

#import <AppKit/AppKit.h>

#include <string>
#include <vector>

#include "base/strings/sys_string_conversions.h"
#include "chrome/browser/renderer_context_menu/render_view_context_menu.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/cocoa/renderer_context_menu/render_view_context_menu_mac_cocoa.h"
#include "chrome/browser/ui/tab_contents/chrome_web_contents_view_delegate.h"
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
      menu_model_.InsertItemAt(at++, command, base::SysNSStringToUTF16(title));
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
    // Chrome's menu for the page, with the host's items.
    auto menu = std::make_unique<NNContextMenu>(
        render_frame_host, params, /*is_paste_enabled=*/true,
        /*is_paste_and_match_style_enabled=*/true,
        view->GetNativeView().GetNativeNSView());
    menu->Init();
    menu->AddHostItems();
    return menu;
  }

 private:
  raw_ptr<content::WebContents> contents_;
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
        return true;  // Background mode: logged, not shown.
      }));
}

}  // namespace nncore
