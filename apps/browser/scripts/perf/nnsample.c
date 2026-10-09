// Main-thread sampler for launch profiling (launch-samples.mjs reads its output; build and use: that file's header).
// Loaded with DYLD_INSERT_LIBRARIES; acts in the app's main process only. NN_SAMPLE_MS=<ms>: from the library's
// constructor (before main), every ~1 ms for that long, suspends the main thread, reads its pc and frame-pointer chain
// and its run state, then writes $NETNYAHOO_DATA_DIR/nnsample.txt: "img <load address> <path>" lines, one
// "s <µs since constructor> <run state> <pc> <return addresses…>" line per sample, and "sym <pc> <image base> <image>\t<dladdr
// symbol>" per distinct pc. The file is written when the time is up: keep NN_SAMPLE_MS shorter than the instance lives.
#include <dlfcn.h>
#include <mach-o/dyld.h>
#include <mach/mach.h>
#include <mach/mach_time.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define MAXS 4000
#define MAXF 96
static uint64_t g_t[MAXS];
static int g_state[MAXS], g_n[MAXS];
static uint64_t g_f[MAXS][MAXF];
static int g_count;
static thread_t g_main;
static uint64_t g_t0;
static int g_ms;

static int readptr(uint64_t addr, uint64_t *out) {
  mach_vm_size_t got = 0;
  extern kern_return_t mach_vm_read_overwrite(vm_map_t, mach_vm_address_t, mach_vm_size_t, mach_vm_address_t, mach_vm_size_t *);
  return mach_vm_read_overwrite(mach_task_self(), addr, 8, (mach_vm_address_t)out, &got) == KERN_SUCCESS && got == 8;
}

static void *sampler(void *arg) {
  mach_timebase_info_data_t tb;
  mach_timebase_info(&tb);
  const uint64_t end = g_t0 + (uint64_t)g_ms * 1000000ull * tb.denom / tb.numer;
  while (mach_absolute_time() < end && g_count < MAXS) {
    const int i = g_count;
    if (thread_suspend(g_main) != KERN_SUCCESS) break;
    arm_thread_state64_t st;
    mach_msg_type_number_t cnt = ARM_THREAD_STATE64_COUNT;
    struct thread_basic_info bi;
    mach_msg_type_number_t bcnt = THREAD_BASIC_INFO_COUNT;
    thread_info(g_main, THREAD_BASIC_INFO, (thread_info_t)&bi, &bcnt);
    g_state[i] = bi.run_state;
    int n = 0;
    if (thread_get_state(g_main, ARM_THREAD_STATE64, (thread_state_t)&st, &cnt) == KERN_SUCCESS) {
      g_f[i][n++] = __darwin_arm_thread_state64_get_pc(st) & 0x0000000fffffffffull;
      g_f[i][n++] = __darwin_arm_thread_state64_get_lr(st) & 0x0000000fffffffffull;
      uint64_t fp = __darwin_arm_thread_state64_get_fp(st);
      while (fp && n < MAXF) {
        uint64_t next, ret;
        if (!readptr(fp, &next) || !readptr(fp + 8, &ret)) break;
        ret &= 0x0000000fffffffffull;
        if (!ret) break;
        g_f[i][n++] = ret;
        if (next <= fp) break;
        fp = next;
      }
    }
    thread_resume(g_main);
    g_n[i] = n;
    g_t[i] = (mach_absolute_time() - g_t0) * tb.numer / tb.denom / 1000;
    g_count++;
    usleep(900);
  }
  const char *dir = getenv("NETNYAHOO_DATA_DIR");
  if (!dir) return NULL;
  char path[2048];
  snprintf(path, sizeof path, "%s/nnsample.txt", dir);
  FILE *f = fopen(path, "w");
  if (!f) return NULL;
  fprintf(f, "t0abs %llu\n", (unsigned long long)(g_t0 * tb.numer / tb.denom / 1000));
  for (uint32_t k = 0; k < _dyld_image_count(); k++)
    fprintf(f, "img %llx %s\n", (unsigned long long)(uintptr_t)_dyld_get_image_header(k), _dyld_get_image_name(k));
  for (int i = 0; i < g_count; i++) {
    fprintf(f, "s %llu %d", (unsigned long long)g_t[i], g_state[i]);
    for (int k = 0; k < g_n[i]; k++) fprintf(f, " %llx", (unsigned long long)g_f[i][k]);
    fputc('\n', f);
  }
  // Each distinct pc: its image (and load address) and, outside Chrome's stripped framework, its symbol.
  static uint64_t seen[200000];
  int nseen = 0;
  for (int i = 0; i < g_count; i++)
    for (int k = 0; k < g_n[i]; k++) {
      const uint64_t pc = g_f[i][k];
      int dup = 0;
      for (int j = 0; j < nseen; j++)
        if (seen[j] == pc) { dup = 1; break; }
      if (dup || nseen >= 200000) continue;
      seen[nseen++] = pc;
      Dl_info info;
      if (dladdr((void *)(uintptr_t)(k ? pc - 1 : pc), &info) && info.dli_fname)
        fprintf(f, "sym %llx %llx %s\t%s\n", (unsigned long long)pc, (unsigned long long)(uintptr_t)info.dli_fbase,
                info.dli_fname, info.dli_sname ? info.dli_sname : "?");
    }
  fclose(f);
  return NULL;
}

__attribute__((constructor)) static void start(void) {
  const char *ms = getenv("NN_SAMPLE_MS");
  if (!ms) return;
  char exe[4096];
  uint32_t size = sizeof exe;
  if (_NSGetExecutablePath(exe, &size) != 0) return;
  const size_t len = strlen(exe);
  if (len < 16 || strcmp(exe + len - 16, "/MacOS/Netnyahoo") != 0) return;  // the main process only
  g_ms = atoi(ms);
  g_main = mach_thread_self();
  g_t0 = mach_absolute_time();
  pthread_t t;
  pthread_create(&t, NULL, sampler, NULL);
  pthread_detach(t);
}
