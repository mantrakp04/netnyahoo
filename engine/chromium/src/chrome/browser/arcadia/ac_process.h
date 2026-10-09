// Copyright 2026 Arcadia. Apache-2.0.
//
// Process-wide diagnostics: they belong to no profile, so these calls ignore
// profile_dir (it may be empty or name an unloaded profile) and never reply
// {error: "profile not loaded"}.
//
//   ac_tasks_list {} -> {tasks: [EngineTask]}: Chrome's task manager
//       (TaskManagerInterface). The first call starts sampling; cpu, memory
//       and gpuMemory fill in within 2 s and stay sampled until 15 s after
//       the last call.
//   ac_tasks_kill {id} -> {ok}: ends a killable task's process;
//       {ok: false} if the task is gone or can't be killed.
//   ac_components_list {} -> {components: [EngineComponent]}: the component
//       updater's components (Widevine is "oimompecagnajdejgnnjijobebaeigek").
//
// EngineTask, the JS type (packages/cef/src/module.ts) with tab ids for
// browser ids: {id, type, title, killable, cpu (% of one core), processors,
// memory, gpuMemory (bytes), tabIds: [chrome.tabs id…], browserIds: []}; the
// app maps tabIds to its browser ids.
// EngineComponent: {id, name, version, state} with state "new"|"checking"|
// "canUpdate"|"downloading"|"decompressing"|"patching"|"updating"|"updated"|
// "upToDate"|"updateError"|"run"|"unknown".

#ifndef CHROME_BROWSER_ARCADIA_AC_PROCESS_H_
#define CHROME_BROWSER_ARCADIA_AC_PROCESS_H_

#include "chrome/browser/arcadia/ac_engine.h"

AC_ENGINE_CALL(ac_tasks_list);
AC_ENGINE_CALL(ac_tasks_kill);
AC_ENGINE_CALL(ac_components_list);

#endif  // CHROME_BROWSER_ARCADIA_AC_PROCESS_H_
