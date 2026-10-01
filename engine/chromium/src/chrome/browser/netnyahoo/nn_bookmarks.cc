// Copyright 2026 Netnyahoo. Apache-2.0.
//
// Bookmarks: Chrome's BookmarkModel is the one store, so chrome.bookmarks,
// Chrome's own UI and the app see the same tree. The app keeps its bookmark UI
// and sync over it, reading the tree and writing changes as ops. Nodes are
// named by their UUID (BookmarkNode::uuid), the permanent folders "bar" and
// "other".
//
//   nn_bookmarks_tree() -> {bar: Node, other: Node}, once the model is loaded.
//     Node: {id, k: "u"|"f", t, u?, a (ms added), key?, c?: [Node]}
//     |key| is the node's sync key when it isn't its UUID (a bookmark synced
//     before Chrome kept them keeps its old key; meta info "nn_sync_key").
//   nn_bookmarks_apply({ops: [Op]}) -> {applied, skipped, invalid: [id]}:
//     {op: "add", id, k, t, u?, a, key?, parent, index, ifAbsent?}
//         (an existing id is moved and updated instead, or left as it is
//          with ifAbsent)
//     {op: "move", id, parent, index}
//     {op: "update", id, t?, u?}
//     {op: "remove", id}
//     In order, stopping at the first op that can't apply (its parent is
//     gone, a move would put a folder inside itself): the rest were made
//     against a tree that isn't Chrome's, so they're skipped rather than risk
//     a removal taking what the app still has. An add whose URL isn't valid
//     is only listed in |invalid|. The app's own changes raise no event.
//   nn_bookmarks_watch() -> {ok}: "bookmarks.changed" {} (coalesced) whenever
//     anything else changes the tree (an extension, Chrome's UI).

#include <algorithm>
#include <cmath>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <utility>

#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/scoped_observation.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "base/time/time.h"
#include "base/uuid.h"
#include "chrome/browser/bookmarks/bookmark_model_factory.h"
#include "chrome/browser/netnyahoo/nn_engine.h"
#include "chrome/browser/profiles/profile.h"
#include "components/bookmarks/browser/bookmark_model.h"
#include "components/bookmarks/browser/bookmark_model_observer.h"
#include "components/bookmarks/browser/bookmark_node.h"
#include "components/bookmarks/browser/scoped_group_bookmark_actions.h"
#include "components/bookmarks/common/bookmark_metrics.h"
#include "url/gurl.h"

namespace netnyahoo {

namespace {

constexpr char kSyncKey[] = "nn_sync_key";
// Deeper than any real tree; a deeper one is refused, not cut short (the app
// would read what's cut as deleted).
constexpr int kMaxDepth = 512;

using bookmarks::BookmarkModel;
using bookmarks::BookmarkNode;

BookmarkModel* ModelFor(Profile* profile) {
  return profile && !profile->IsOffTheRecord()
             ? BookmarkModelFactory::GetForBrowserContext(profile)
             : nullptr;
}

double Ms(base::Time time) {
  return std::floor(time.InMillisecondsFSinceUnixEpoch());
}

std::optional<base::DictValue> NodeValue(const BookmarkNode* node, int depth) {
  if (depth > kMaxDepth) {
    return std::nullopt;
  }
  base::DictValue value;
  value.Set("id", node->uuid().AsLowercaseString());
  value.Set("t", base::UTF16ToUTF8(node->GetTitle()));
  value.Set("a", Ms(node->date_added()));
  std::string key;
  if (node->GetMetaInfo(kSyncKey, &key) && !key.empty()) {
    value.Set("key", key);
  }
  if (node->is_url()) {
    value.Set("k", "u");
    value.Set("u", node->url().spec());
    return value;
  }
  value.Set("k", "f");
  base::ListValue children;
  for (const auto& child : node->children()) {
    std::optional<base::DictValue> child_value =
        NodeValue(child.get(), depth + 1);
    if (!child_value) {
      return std::nullopt;
    }
    children.Append(std::move(*child_value));
  }
  value.Set("c", std::move(children));
  return value;
}

const BookmarkNode* Find(BookmarkModel* model, const std::string& id) {
  if (id == "bar") {
    return model->bookmark_bar_node();
  }
  if (id == "other") {
    return model->other_node();
  }
  base::Uuid uuid = base::Uuid::ParseLowercase(id);
  if (!uuid.is_valid()) {
    return nullptr;
  }
  return model->GetNodeByUuid(
      uuid, BookmarkModel::NodeTypeForUuidLookup::kLocalOrSyncableNodes);
}

bool IsAncestor(const BookmarkNode* node, const BookmarkNode* of) {
  for (const BookmarkNode* at = of; at; at = at->parent()) {
    if (at == node) {
      return true;
    }
  }
  return false;
}

// MARK: Watching

class Watcher;
std::map<Profile*, std::unique_ptr<Watcher>>& Watchers() {
  static base::NoDestructor<std::map<Profile*, std::unique_ptr<Watcher>>>
      watchers;
  return *watchers;
}

// Tells the app when anything but its own ops changes the tree, once per
// burst.
class Watcher : public bookmarks::BookmarkModelObserver {
 public:
  Watcher(Profile* profile, BookmarkModel* model) : profile_(profile) {
    observation_.Observe(model);
  }

  // While the app's ops run, changes are its own.
  void set_applying(bool applying) { applying_ = applying; }

  void BookmarkModelLoaded(bool) override { Changed(); }
  void BookmarkModelBeingDeleted() override {
    observation_.Reset();
    Watchers().erase(profile_);  // Deletes this.
  }
  void BookmarkNodeMoved(const BookmarkNode*,
                         size_t,
                         const BookmarkNode*,
                         size_t) override {
    Changed();
  }
  void BookmarkNodeAdded(const BookmarkNode*, size_t, bool) override {
    Changed();
  }
  void BookmarkNodeRemoved(const BookmarkNode*,
                           size_t,
                           const BookmarkNode*,
                           const std::set<GURL>&,
                           const base::Location&) override {
    Changed();
  }
  void BookmarkNodeChanged(const BookmarkNode*) override { Changed(); }
  void BookmarkNodeFaviconChanged(const BookmarkNode*) override {}
  void BookmarkNodeChildrenReordered(const BookmarkNode*) override {
    Changed();
  }
  void BookmarkAllUserNodesRemoved(const std::set<GURL>&,
                                   const base::Location&) override {
    Changed();
  }

 private:
  void Changed() {
    if (applying_ || pending_) {
      return;
    }
    pending_ = true;
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&Watcher::Send, weak_factory_.GetWeakPtr()));
  }

  void Send() {
    pending_ = false;
    Emit("bookmarks.changed", profile_, base::DictValue());
  }

  raw_ptr<Profile> profile_;
  bool applying_ = false;
  bool pending_ = false;
  base::ScopedObservation<BookmarkModel, bookmarks::BookmarkModelObserver>
      observation_{this};
  base::WeakPtrFactory<Watcher> weak_factory_{this};
};

// Runs |then| once the model has read its file.
class WhenLoaded : public bookmarks::BookmarkModelObserver {
 public:
  static void Run(BookmarkModel* model, base::OnceClosure then) {
    if (model->loaded()) {
      return std::move(then).Run();
    }
    new WhenLoaded(model, std::move(then));
  }

  void BookmarkModelLoaded(bool) override {
    observation_.Reset();
    base::OnceClosure then = std::move(then_);
    delete this;
    std::move(then).Run();
  }
  void BookmarkModelBeingDeleted() override {
    observation_.Reset();
    delete this;
  }
  void BookmarkNodeMoved(const BookmarkNode*,
                         size_t,
                         const BookmarkNode*,
                         size_t) override {}
  void BookmarkNodeAdded(const BookmarkNode*, size_t, bool) override {}
  void BookmarkNodeRemoved(const BookmarkNode*,
                           size_t,
                           const BookmarkNode*,
                           const std::set<GURL>&,
                           const base::Location&) override {}
  void BookmarkNodeChanged(const BookmarkNode*) override {}
  void BookmarkNodeFaviconChanged(const BookmarkNode*) override {}
  void BookmarkNodeChildrenReordered(const BookmarkNode*) override {}
  void BookmarkAllUserNodesRemoved(const std::set<GURL>&,
                                   const base::Location&) override {}

 private:
  WhenLoaded(BookmarkModel* model, base::OnceClosure then)
      : then_(std::move(then)) {
    observation_.Observe(model);
  }

  base::OnceClosure then_;
  base::ScopedObservation<BookmarkModel, bookmarks::BookmarkModelObserver>
      observation_{this};
};

// MARK: Ops

size_t Clamp(double index, const BookmarkNode* parent) {
  if (index < 0) {
    return 0;
  }
  return std::min(static_cast<size_t>(index), parent->children().size());
}

// Move semantics as the app means them: |index| is the node's index among
// |parent|'s children once moved.
void MoveTo(BookmarkModel* model,
            const BookmarkNode* node,
            const BookmarkNode* parent,
            double index) {
  size_t at = Clamp(index, parent);
  if (node->parent() == parent) {
    const size_t current = static_cast<size_t>(*parent->GetIndexOf(node));
    if (current == at) {
      return;
    }
    // BookmarkModel::Move inserts before the child at |at| as it is now.
    if (at > current) {
      at++;
    }
  }
  model->Move(node, parent, std::min(at, parent->children().size()));
}

enum class Result { kApplied, kFailed, kInvalid };

Result Apply(BookmarkModel* model, const base::DictValue& op);

bool Applied(BookmarkModel* model, const base::DictValue& op) {
  return Apply(model, op) == Result::kApplied;
}

Result Apply(BookmarkModel* model, const base::DictValue& op) {
  const std::string* kind = op.FindString("op");
  const std::string* id = op.FindString("id");
  if (!kind || !id) {
    return Result::kFailed;
  }
  const BookmarkNode* node = Find(model, *id);
  if (*kind == "remove") {
    if (!node || model->is_permanent_node(node)) {
      return Result::kFailed;
    }
    model->Remove(node, bookmarks::metrics::BookmarkEditSource::kOther,
                  FROM_HERE);
    return Result::kApplied;
  }
  if (*kind == "update") {
    if (!node || model->is_permanent_node(node)) {
      return Result::kFailed;
    }
    if (const std::string* title = op.FindString("t")) {
      model->SetTitle(node, base::UTF8ToUTF16(*title),
                      bookmarks::metrics::BookmarkEditSource::kOther);
    }
    const std::string* url = op.FindString("u");
    if (url && node->is_url() && GURL(*url).is_valid()) {
      model->SetURL(node, GURL(*url),
                    bookmarks::metrics::BookmarkEditSource::kOther);
    }
    return Result::kApplied;
  }
  const std::string* parent_id = op.FindString("parent");
  const BookmarkNode* parent = parent_id ? Find(model, *parent_id) : nullptr;
  if (!parent || !parent->is_folder()) {
    return Result::kFailed;
  }
  const double index = op.FindDouble("index").value_or(
      static_cast<double>(parent->children().size()));
  if (*kind == "move") {
    if (!node || model->is_permanent_node(node) || IsAncestor(node, parent)) {
      return Result::kFailed;
    }
    MoveTo(model, node, parent, index);
    return Result::kApplied;
  }
  if (*kind != "add") {
    return Result::kFailed;
  }
  const std::string* title = op.FindString("t");
  const std::u16string title16 = title ? base::UTF8ToUTF16(*title) : u"";
  const bool folder = op.FindString("k") && *op.FindString("k") == "f";
  if (node && op.FindBool("ifAbsent").value_or(false)) {
    return Result::kApplied;
  }
  if (node) {
    // Already there (an op sent twice): where and what the app says.
    if (model->is_permanent_node(node) || IsAncestor(node, parent)) {
      return Result::kFailed;
    }
    MoveTo(model, node, parent, index);
    Applied(model, base::DictValue()
                     .Set("op", "update")
                     .Set("id", *id)
                     .Set("t", title ? *title : "")
                     .Set("u", op.FindString("u") ? *op.FindString("u") : ""));
    return Result::kApplied;
  }
  base::Uuid uuid = base::Uuid::ParseLowercase(*id);
  if (!uuid.is_valid()) {
    return Result::kFailed;
  }
  const double added = op.FindDouble("a").value_or(0);
  std::optional<base::Time> created;
  if (added > 0) {
    created = base::Time::FromMillisecondsSinceUnixEpoch(added);
  }
  const size_t at = Clamp(index, parent);
  BookmarkNode::MetaInfoMap meta;
  if (const std::string* key = op.FindString("key"); key && !key->empty()) {
    meta[kSyncKey] = *key;
  }
  if (folder) {
    model->AddFolder(parent, at, title16, meta.empty() ? nullptr : &meta,
                     created, uuid);
    return Result::kApplied;
  }
  const std::string* url = op.FindString("u");
  GURL gurl(url ? *url : std::string());
  if (!gurl.is_valid()) {
    return Result::kInvalid;
  }
  model->AddURL(parent, at, title16, gurl, meta.empty() ? nullptr : &meta,
                created, uuid);
  return Result::kApplied;
}

}  // namespace

}  // namespace netnyahoo

using netnyahoo::Call;
using netnyahoo::Reply;

NN_ENGINE_CALL(nn_bookmarks_tree) {
  Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  bookmarks::BookmarkModel* model = netnyahoo::ModelFor(call.profile());
  if (!model) {
    return call.TakeReply().Error("no bookmarks");
  }
  netnyahoo::WhenLoaded::Run(
      model,
      base::BindOnce(
          [](base::WeakPtr<Profile> profile, Reply reply) {
            auto* model = profile ? netnyahoo::ModelFor(profile.get()) : nullptr;
            if (!model) {
              return reply.Error("profile went away");
            }
            auto bar = netnyahoo::NodeValue(model->bookmark_bar_node(), 0);
            auto other = netnyahoo::NodeValue(model->other_node(), 0);
            if (!bar || !other) {
              return reply.Error("bookmarks nested too deep");
            }
            reply.Send(base::DictValue()
                           .Set("bar", std::move(*bar))
                           .Set("other", std::move(*other)));
          },
          call.profile()->GetWeakPtr(), call.TakeReply()));
}

NN_ENGINE_CALL(nn_bookmarks_apply) {
  Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  bookmarks::BookmarkModel* model = netnyahoo::ModelFor(call.profile());
  if (!model) {
    return call.TakeReply().Error("no bookmarks");
  }
  const base::ListValue* ops = call.args().FindList("ops");
  base::ListValue list = ops ? ops->Clone() : base::ListValue();
  netnyahoo::WhenLoaded::Run(
      model,
      base::BindOnce(
          [](base::WeakPtr<Profile> profile, base::ListValue ops, Reply reply) {
            auto* model = profile ? netnyahoo::ModelFor(profile.get()) : nullptr;
            if (!model) {
              return reply.Error("profile went away");
            }
            auto& watchers = netnyahoo::Watchers();
            auto it = watchers.find(profile.get());
            netnyahoo::Watcher* watcher =
                it == watchers.end() ? nullptr : it->second.get();
            if (watcher) {
              watcher->set_applying(true);
            }
            int applied = 0, skipped = 0;
            base::ListValue invalid;
            {
              bookmarks::ScopedGroupBookmarkActions group(model);
              for (const base::Value& op : ops) {
                const auto result =
                    op.is_dict() ? netnyahoo::Apply(model, op.GetDict())
                                 : netnyahoo::Result::kFailed;
                if (result == netnyahoo::Result::kApplied) {
                  applied++;
                } else if (result == netnyahoo::Result::kInvalid) {
                  invalid.Append(*op.GetDict().FindString("id"));
                } else {
                  break;
                }
              }
              skipped = static_cast<int>(ops.size()) - applied -
                        static_cast<int>(invalid.size());
            }
            if (watcher) {
              watcher->set_applying(false);
            }
            reply.Send(base::DictValue()
                           .Set("applied", applied)
                           .Set("skipped", skipped)
                           .Set("invalid", std::move(invalid)));
          },
          call.profile()->GetWeakPtr(), std::move(list), call.TakeReply()));
}

NN_ENGINE_CALL(nn_bookmarks_watch) {
  Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  bookmarks::BookmarkModel* model = netnyahoo::ModelFor(call.profile());
  if (!model) {
    return call.TakeReply().Error("no bookmarks");
  }
  auto& watchers = netnyahoo::Watchers();
  if (!watchers.contains(call.profile())) {
    watchers[call.profile()] =
        std::make_unique<netnyahoo::Watcher>(call.profile(), model);
  }
  call.TakeReply().Ok();
}
