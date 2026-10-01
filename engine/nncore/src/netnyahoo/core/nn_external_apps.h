// Chrome's "Open <app>?" dialog for the host's tabs, asked of the host instead
// (tab:externalAppRequest:, -[NNCoreEngine resolveExternalApp:open:remember:]).

#ifndef NETNYAHOO_CORE_NN_EXTERNAL_APPS_H_
#define NETNYAHOO_CORE_NN_EXTERNAL_APPS_H_

#include <string>

namespace nncore {

void InstallExternalAppPrompts();
void ResolveExternalApp(const std::string& request_id, bool open, bool remember);

}  // namespace nncore

#endif  // NETNYAHOO_CORE_NN_EXTERNAL_APPS_H_
