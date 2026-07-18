#define _GNU_SOURCE

#include <errno.h>
#include <dirent.h>
#include <fcntl.h>
#include <grp.h>
#include <inttypes.h>
#include <pwd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

static void die(const char *message) {
  fprintf(stderr, "%s\n", message);
  exit(126);
}

static void secure_environment(void) {
  if (clearenv() != 0) die("Unable to clear environment");
  if (setenv("PATH", "/usr/sbin:/usr/bin:/sbin:/bin", 1) != 0) die("Unable to set PATH");
  if (setenv("LANG", "C.UTF-8", 1) != 0) die("Unable to set locale");
}

static void run_systemctl(const char *service) {
  execl("/usr/bin/systemctl", "systemctl", "restart", service, (char *)NULL);
  die("Unable to execute systemctl");
}

static void run_backup(void) {
  struct passwd *account = getpwnam("coffee");
  if (!account) die("Backup account is unavailable");
  if (initgroups(account->pw_name, account->pw_gid) != 0) die("Unable to initialize backup groups");
  if (setgid(account->pw_gid) != 0 || setuid(account->pw_uid) != 0) die("Unable to drop backup privileges");
  if (setenv("HOME", account->pw_dir, 1) != 0) die("Unable to set backup home");
  execl("/home/coffee/backup-palworld.sh", "backup-palworld.sh", (char *)NULL);
  die("Unable to execute Palworld backup");
}

static void schedule_pocket_restart(void) {
  pid_t child = fork();
  if (child < 0) die("Unable to schedule PocketCodex restart");
  if (child > 0) {
    puts("PocketCodex restart scheduled");
    return;
  }

  if (setsid() < 0) _exit(126);
  int nullfd = open("/dev/null", O_RDWR);
  if (nullfd >= 0) {
    dup2(nullfd, STDIN_FILENO);
    dup2(nullfd, STDOUT_FILENO);
    dup2(nullfd, STDERR_FILENO);
    if (nullfd > STDERR_FILENO) close(nullfd);
  }
  sleep(2);
  execl("/usr/bin/docker", "docker", "restart", "codex-web", (char *)NULL);
  _exit(126);
}

static int has_backup_name(const char *name) {
  const char *prefix = "palworld-save-";
  const char *suffix = ".tar.gz";
  size_t length = strlen(name);
  size_t prefix_length = strlen(prefix);
  size_t suffix_length = strlen(suffix);
  return length > prefix_length + suffix_length
    && strncmp(name, prefix, prefix_length) == 0
    && strcmp(name + length - suffix_length, suffix) == 0;
}

static void report_backup_usage(void) {
  const char *directory = "/mnt/d/palworld-backups";
  DIR *handle = opendir(directory);
  if (!handle) die("Backup directory is unavailable");
  uint64_t bytes = 0;
  unsigned int count = 0;
  struct dirent *entry;
  while ((entry = readdir(handle)) != NULL) {
    if (!has_backup_name(entry->d_name)) continue;
    char file_path[4096];
    int written = snprintf(file_path, sizeof(file_path), "%s/%s", directory, entry->d_name);
    if (written < 0 || (size_t)written >= sizeof(file_path)) continue;
    struct stat metadata;
    if (lstat(file_path, &metadata) == 0 && S_ISREG(metadata.st_mode)) {
      count += 1;
      bytes += (uint64_t)metadata.st_size;
    }
  }
  closedir(handle);
  printf("{\"directory\":\"%s\",\"count\":%u,\"bytes\":%" PRIu64 "}\n", directory, count, bytes);
}

int main(int argc, char **argv) {
  struct passwd *caller = getpwnam("codexbot");
  if (argc != 2 || !caller || getuid() != caller->pw_uid) die("Denied");
  secure_environment();

  if (strcmp(argv[1], "docker-cache") == 0) {
    execl("/usr/bin/docker", "docker", "system", "df", "--format",
      "{{.Type}}\\t{{.Size}}\\t{{.Reclaimable}}", (char *)NULL);
    die("Unable to inspect Docker storage");
  }
  if (strcmp(argv[1], "backup-usage") == 0) {
    report_backup_usage();
    return 0;
  }
  if (strcmp(argv[1], "pal-backup") == 0) {
    run_backup();
    return 0;
  }
  if (strcmp(argv[1], "restart-palworld") == 0) {
    run_systemctl("palworld.service");
  }
  if (strcmp(argv[1], "restart-frp") == 0) {
    run_systemctl("sakurafrp-palworld.service");
  }
  if (strcmp(argv[1], "restart-pocket") == 0) {
    schedule_pocket_restart();
    return 0;
  }

  die("Denied");
  return 126;
}
