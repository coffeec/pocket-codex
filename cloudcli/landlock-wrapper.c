// SPDX-License-Identifier: AGPL-3.0-or-later
#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <linux/landlock.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

#ifndef LANDLOCK_ACCESS_FS_REFER
#define LANDLOCK_ACCESS_FS_REFER (1ULL << 13)
#endif
#ifndef LANDLOCK_ACCESS_FS_TRUNCATE
#define LANDLOCK_ACCESS_FS_TRUNCATE (1ULL << 14)
#endif

static const char *real_codex =
    "/app/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex";

static void fail(const char *message) {
  fprintf(stderr, "pocket-codex-landlock: %s: %s\n", message, strerror(errno));
  exit(126);
}

static int starts_with_project_root(const char *path) {
  return strncmp(path, "/workspaces/ssd/", 16) == 0 ||
         strncmp(path, "/workspaces/disk/", 17) == 0;
}

static uint64_t read_rights(void) {
  return LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_READ_FILE |
         LANDLOCK_ACCESS_FS_READ_DIR;
}

static uint64_t write_rights(int abi) {
  uint64_t rights = read_rights() | LANDLOCK_ACCESS_FS_WRITE_FILE |
                    LANDLOCK_ACCESS_FS_REMOVE_DIR |
                    LANDLOCK_ACCESS_FS_REMOVE_FILE |
                    LANDLOCK_ACCESS_FS_MAKE_CHAR |
                    LANDLOCK_ACCESS_FS_MAKE_DIR |
                    LANDLOCK_ACCESS_FS_MAKE_REG |
                    LANDLOCK_ACCESS_FS_MAKE_SOCK |
                    LANDLOCK_ACCESS_FS_MAKE_FIFO |
                    LANDLOCK_ACCESS_FS_MAKE_BLOCK |
                    LANDLOCK_ACCESS_FS_MAKE_SYM;
  if (abi >= 2) rights |= LANDLOCK_ACCESS_FS_REFER;
  if (abi >= 3) rights |= LANDLOCK_ACCESS_FS_TRUNCATE;
  return rights;
}

static void add_path_rule(int ruleset_fd, const char *path, uint64_t rights,
                          int required) {
  struct stat info;
  if (stat(path, &info) != 0) {
    if (required) fail(path);
    return;
  }

  uint64_t allowed = rights;
  if (!S_ISDIR(info.st_mode)) {
    allowed &= ~(LANDLOCK_ACCESS_FS_READ_DIR |
                 LANDLOCK_ACCESS_FS_REMOVE_DIR |
                 LANDLOCK_ACCESS_FS_REMOVE_FILE |
                 LANDLOCK_ACCESS_FS_MAKE_CHAR |
                 LANDLOCK_ACCESS_FS_MAKE_DIR |
                 LANDLOCK_ACCESS_FS_MAKE_REG |
                 LANDLOCK_ACCESS_FS_MAKE_SOCK |
                 LANDLOCK_ACCESS_FS_MAKE_FIFO |
                 LANDLOCK_ACCESS_FS_MAKE_BLOCK |
                 LANDLOCK_ACCESS_FS_MAKE_SYM |
                 LANDLOCK_ACCESS_FS_REFER);
  }

  int parent_fd = open(path, O_PATH | O_CLOEXEC);
  if (parent_fd < 0) {
    if (required) fail(path);
    return;
  }
  struct landlock_path_beneath_attr rule = {
      .allowed_access = allowed,
      .parent_fd = parent_fd,
  };
  if (syscall(__NR_landlock_add_rule, ruleset_fd, LANDLOCK_RULE_PATH_BENEATH,
              &rule, 0) != 0) {
    close(parent_fd);
    fail(path);
  }
  close(parent_fd);
}

static void apply_landlock(const char *project) {
  int abi = syscall(__NR_landlock_create_ruleset, NULL, 0,
                    LANDLOCK_CREATE_RULESET_VERSION);
  if (abi < 1) fail("Landlock is unavailable");

  uint64_t handled = write_rights(abi);
  struct landlock_ruleset_attr attr = {.handled_access_fs = handled};
  int ruleset_fd = syscall(__NR_landlock_create_ruleset, &attr, sizeof(attr), 0);
  if (ruleset_fd < 0) fail("create ruleset");

  const char *readonly[] = {
      "/app", "/usr", "/etc", "/home/node/.codex", NULL,
  };
  for (size_t index = 0; readonly[index]; index++) {
    add_path_rule(ruleset_fd, readonly[index], read_rights(), 1);
  }
  add_path_rule(ruleset_fd, "/dev",
                read_rights() | LANDLOCK_ACCESS_FS_WRITE_FILE, 1);

  const char *writable[] = {
      project,
      "/tmp",
      "/home/node/.codex",
      NULL,
  };
  for (size_t index = 0; writable[index]; index++) {
    add_path_rule(ruleset_fd, writable[index], handled, index == 0);
  }

  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) fail("no_new_privs");
  if (syscall(__NR_landlock_restrict_self, ruleset_fd, 0) != 0) {
    fail("restrict self");
  }
  close(ruleset_fd);
}

int main(int argc, char **argv) {
  char *project_arg = NULL;
  int boundary_check = 0;
  char *rewritten[argc + 1];
  int output = 0;
  rewritten[output++] = (char *)real_codex;

  for (int index = 1; index < argc; index++) {
    if (strcmp(argv[index], "--pocket-landlock-check") == 0) {
      boundary_check = 1;
      continue;
    }
    if (strcmp(argv[index], "--add-dir") == 0) {
      errno = EPERM;
      fail("additional directories are disabled");
    }
    if (strcmp(argv[index], "--cd") == 0 && index + 1 < argc) {
      project_arg = argv[index + 1];
    }
    if (strcmp(argv[index], "--sandbox") == 0 && index + 1 < argc) {
      rewritten[output++] = argv[index];
      rewritten[output++] = "danger-full-access";
      index++;
      continue;
    }
    rewritten[output++] = argv[index];
  }
  rewritten[output] = NULL;

  if (!project_arg) {
    errno = EINVAL;
    fail("--cd is required");
  }
  char project[PATH_MAX];
  if (!realpath(project_arg, project)) fail("resolve project");
  if (!starts_with_project_root(project)) {
    errno = EPERM;
    fail("project is outside PocketCodex storage roots");
  }

  apply_landlock(project);
  if (boundary_check) {
    int probe = open("/home/node/.cloudcli/auth.db", O_RDONLY | O_CLOEXEC);
    if (probe >= 0) {
      close(probe);
      fprintf(stderr, "pocket-codex-landlock: boundary check failed\n");
      return 1;
    }
    if (errno != EACCES && errno != EPERM) fail("boundary check");
    printf("cloudcli_readable=false\n");
    return 0;
  }
  execv(real_codex, rewritten);
  fail("exec Codex");
  return 126;
}
