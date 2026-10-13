# Release security remediation and controlled maintenance

Checkpoint 3A makes repository corrections and rehearses changes in disposable
fixtures. **It does not authorize live credential rotation, ACL application,
container recreation, Git synchronization or Railway provisioning.** Each needs
the next explicit approval checkpoint. Treat the previously published database
passwords as compromised even though the latest Compose file contains no literals.
Old passwords and removed operational details remain in Git history; history
rewriting or publication of those historical details needs separate review.

## Local configuration

Use separate files for separate purposes:

- `.env` remains Laravel's existing ignored configuration and encryption key.
  Do not replace it with a template or regenerate its key on an existing install.
- `.env.docker.example` is a public, password-free template.
- `.env.docker.local` is ignored Compose interpolation input. The prepared copy
  has **blank passwords**; protect ACLs before entering live values. It cannot
  start services until required fields are populated. No live credentials were
  copied into it during 3A.

All subsequent Compose commands must include:

```powershell
docker compose --env-file .env.docker.local config --quiet
```

Run this only after approved local secret provisioning. Never print rendered
`config`, `config --environment`, `docker inspect` environment data or dotenv
contents to public logs. Shell variables can override interpolation input;
remove stale `MGAEMS_DOCKER_*` overrides from the operator process and verify
resolved settings privately. Single-quote dotenv passwords that contain `$` or
`#`; vault-generated hexadecimal secrets avoid interpolation ambiguity.
[Compose interpolation](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/).

The app receives only its application database credentials. Root credentials
are supplied only to MySQL. Laravel uses `mysql:3306` inside the Compose network;
the host listener is proposed as `127.0.0.1:3307`. Existing named vendor and MySQL
volumes are retained. The authenticated health check references the container's
root password via `MYSQL_PWD`, verifies `SELECT 1` and does not put a literal
password in its command. MySQL initialization variables do **not** update users
in an existing data volume.

## Windows ACL plan and rollback — future approved checkpoint only

Current dotenv/private storage inherits broad local-user access. The verified
external backup/archive is already restricted and must not be broadened.
Docker Desktop's sharing backend runs as the operator on the reviewed host;
the Docker service uses SYSTEM when enabled. Linux UID `www-data` is not a
Windows SID and must not be added as a fictitious Windows principal.

Limit permission changes to `.env`, `.env.docker.local`, `storage/app/private`
and its descendants, and any existing `storage/*.key` files. Generated private
report artifacts are within that subtree. Do not change the whole repository,
public assets, MySQL volume or unrelated directories. Reject reparse points;
resolve every target and verify it stays within the approved scopes.

The read-only SDDL inventory is held in protected operator audit storage. Before
application, refresh it, check operator/Docker identities again and take a
protected snapshot of each target's owner/group/DACL. Use an elevated operator
only when necessary to preserve/restore ownership. Keep the snapshot outside Git.

Proposed ACL: disable inheritance without copying broad inherited grants;
allow the verified operator, SYSTEM and local Administrators the necessary
custody/recovery access. Do not grant Everyone, Users, Authenticated Users or
blanket sandbox groups. Existing protected backups retain their narrower ACL.
Apply the reviewed descriptors to each inventoried target explicitly; no broad
repository recursion or string-built deletion command is needed.

Reviewable PowerShell operation outline (not executed in 3A):

```powershell
# $record is one reviewed target from the protected scope/SDDL inventory.
$security = if ($record.directory) {
    [Security.AccessControl.DirectorySecurity]::new()
} else { [Security.AccessControl.FileSecurity]::new() }
$security.SetAccessRuleProtection($true, $false)
$operatorSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$security.SetOwner($operatorSid)
$inheritance = if ($record.directory) {
    [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
} else { [Security.AccessControl.InheritanceFlags]::None }
foreach ($principal in @($operatorSid.Value, 'S-1-5-18', 'S-1-5-32-544')) {
    $identity = [Security.Principal.SecurityIdentifier]::new($principal)
    $rule = [Security.AccessControl.FileSystemAccessRule]::new(
        $identity, [Security.AccessControl.FileSystemRights]::FullControl,
        $inheritance, [Security.AccessControl.PropagationFlags]::None,
        [Security.AccessControl.AccessControlType]::Allow)
    $security.AddAccessRule($rule)
}
Set-Acl -LiteralPath $record.path -AclObject $security
```

The outline handles one previously scope-checked target: review the exact
descriptor/principals before applying it to the approved inventory. Verify unrelated local users cannot read the
dotenv/private files. Test Docker sharing with a new synthetic-only subdirectory
mounted alone into disposable containers as UID 0 and UID 33; confirm read/write
without mounting secrets or school documents. Check normal operator access.
If sharing or custody fails, stop and restore each original descriptor:

```powershell
$original = if ($record.directory) {
    [Security.AccessControl.DirectorySecurity]::new()
} else { [Security.AccessControl.FileSecurity]::new() }
$original.SetSecurityDescriptorSddlForm($record.sddl)
Set-Acl -LiteralPath $record.path -AclObject $original
```

Compare restored owner/group/DACL to the snapshot. Applying/rolling back ACLs
on this Windows host remains unverified because 3A forbids those changes. Do not
claim that Docker sharing has been certified under unapplied permissions.

## Credential and network change — future approved maintenance window

Read-only inventory identified one application account with privileges confined
to the application database and root entries for local and remote administration.
Their exact names, host patterns, grants and plugins are kept in private evidence.
All reviewed accounts use `caching_sha2_password` and had no secondary password.
Refresh this inventory immediately before the live window; include password
policy, grants and unexpected connected sessions without exporting hashes or SQL
containing private records.

The MySQL 8.0 disposable rehearsal verifies dual-password rotation for an app
account and root `localhost`/remote-host entries, connection tests, rollback,
discarding old passwords, retained data-volume restart and loopback networking.
[MySQL password management](https://dev.mysql.com/doc/refman/8.0/en/password-management.html).

1. Obtain explicit approval, protect ACLs, verify current database/file/key
   backups and recovery evidence, and place existing verified credentials in
   the protected Docker env file. Record current app/MySQL image IDs, volumes,
   network aliases, version/grants and rollback descriptors. No new key or
   application User password is part of this change.
2. Schedule downtime, stop **only the app**, then apply the loopback binding to
   **only MySQL** using the same initialized data volume and current credentials:

   ```powershell
   docker compose --env-file .env.docker.local stop app
   docker compose --env-file .env.docker.local up -d --no-deps --no-build --pull never --force-recreate mysql
   ```

   Keep the existing MySQL image; this is not an engine upgrade. Confirm the
   original data-volume name/server identity, health and `127.0.0.1` binding.
   Container-to-container traffic still uses `mysql:3306`, not the host port.
   Remote workstation access to the old all-interface listener intentionally
   ceases; approve that workflow change beforehand.
3. Generate separate strong app/root passwords directly in the operator vault.
   Execute account-specific native MySQL changes through reviewed secret stdin
   or a protected client workflow; never `mysql -e` with secret SQL, password
   argv, console echo, command history or committed SQL scripts. Use exact
   verified account names and safely quoted vault values, never untrusted
   account identifiers. No Laravel
   migration or PHP 8.2/Laravel 13 command is involved.

   SQL shape, using placeholders only:

   ```sql
   ALTER USER '<application-user>'@'<verified-host>'
       IDENTIFIED BY '<vault-new-application-password>' RETAIN CURRENT PASSWORD;
   ALTER USER 'root'@'<each-verified-root-host>'
       IDENTIFIED BY '<vault-new-root-password>' RETAIN CURRENT PASSWORD;
   ```

   Rotate every verified root host entry. Do not change grants, account hosts,
   authentication plugin, school rows, User/Staff links or the migration ledger.
   Retention is a short rollback window; compromised passwords still work then.
4. Verify **new connections** with both new and retained passwords from the
   application network, local root client and permitted localhost host client.
   Use native PDO/MySQL `SELECT 1`, `CURRENT_USER()`, `DATABASE()` and privately
   verified server UUID in a read-only transaction. Never log connection strings,
   passwords or private rows. MySQL password changes do not kill existing
   authenticated sessions; review and revoke unexpected sessions under the
   approved maintenance procedure rather than assuming rotation disconnects them.
5. Update the protected env file to the new app/root values and recreate only
   MySQL so health/initialization metadata is consistent. Recreate the app with
   its **captured old image and original vendor volume pinned via an operator
   override**; do not combine credential rotation with the PHP upgrade. Clear
   stale configuration using the compatible old runtime only if present, and
   keep Laravel `.env`, APP_KEY and session identity unchanged.

   ```powershell
   docker compose --env-file .env.docker.local up -d --no-deps --no-build --pull never --force-recreate mysql
   docker compose --env-file .env.docker.local -f compose.yaml -f <pinned-old-app-override> up -d --no-deps --no-build --pull never app
   ```

6. Verify native read-only connectivity, legitimate operator login/logout and
   role boundaries. During retention, rollback restores the previous protected
   Docker config and captured app image/vendor; retained passwords still work.
   It does **not** restore/reset the database or delete/recreate volumes. Keep
   network exposure restricted rather than automatically reopening all interfaces.
7. After successful smoke tests and review of other clients, discard secondary
   passwords for the application and **each** root entry:

   ```sql
   ALTER USER '<application-user>'@'<verified-host>' DISCARD OLD PASSWORD;
   ALTER USER 'root'@'<each-verified-root-host>' DISCARD OLD PASSWORD;
   ```

   Confirm fresh old-password connections fail and new ones succeed for all
   paths; the existing-volume initialization variables cannot perform this step.
   After discard, old-config rollback is no longer valid: retain new credentials
   on an old image or use a separately approved emergency rotation. Do not
   restore compromised passwords as a routine rollback. Remove obsolete copies
   only under reviewed retention/backup policy; history remains independently
   subject to access/cleanup review.

Expect application downtime while the app is stopped and MySQL is recreated.
Reserve a maintenance window with restart and rollback headroom; duration has
not been measured on live school workloads. Never use `down -v`, `migrate:fresh`,
`db:wipe`, general seeders, volume pruning or automatic database migrations.

## Subsequent PHP 8.3 transition

After rotation is verified, separately approve the application-only transition.
Keep MySQL running. Preinstall the unchanged lock in a **new** isolated vendor
volume with the tested PHP 8.3 image; retain the old image/vendor for rollback.
Use an operator Compose override selecting that external new volume. Validate
platform/lock/audit, clear stale config/routes/views/compiled manifests with the
matching runtime and discover packages under the new vendor. Start only app
with `--no-deps --no-build --pull never`. Use the protected Docker env file and
current rotated credentials for both forward and rollback operations. Preserve
APP_KEY, timezone, nonstaging PHP session serialization and filesystem storage.
No migration is needed when the actual ledger/schema matches the verified
existing installation. Local `/healthz` remains staging-only; use native DB and
authorized app smoke checks. Do not install the new lock into PHP 8.2 or the
old vendor volume.

## Full recovery and limitations

The earlier protected native MySQL backup/restore remains verified. 3A additionally
rehearses a **synthetic** whole-app recovery into a different MySQL 8.4 server and
new storage volume after removing the source fixture containers. SQL and storage
archives exclude the independent application key. A separately supplied original
key restores encrypted JSON sessions and bearer material; a wrong key fails
closed. Private uploads, latest/earlier PDF hashes, authenticated downloads,
Health exclusion, mail isolation and `www-data` write permissions are checked.

Repeat with an explicitly reviewed PHP 8.3/Laravel 13 image:

```powershell
powershell -NoProfile -File tests/safe/compose_security.ps1
powershell -NoProfile -File tests/safe/staging_recovery_mysql.ps1 -Image <reviewed-Laravel13-image>
```

The recovery runner mounts only test PHP files and its own volumes. Historical
PHP 8.2/development-vendor concurrency launchers must not be used with this
upgrade; use sanitized PHP 8.3 fixtures and a fresh isolated dependency graph.

Real recovery requires consistent database/private-file snapshots, generated
artifacts, matching application source/dependencies, separately vaulted APP_KEY,
auth/session settings and reviewed Windows/POSIX permissions. Coordinate a
quiet file-writing window when needed; a DB snapshot alone cannot synchronize
uploaded files. Never place the key inside public docs or an unprotected archive.
Restore only to an independently verified disposable environment first. Real
school file/key recovery, Windows ACL application, encrypted offsite/binlog
recovery and the legacy app backup endpoint/MariaDB dump client remain uncertified.

## Railway demonstration requirements — not provisioned

Use separate project **`mgaems-staging`**, an empty MySQL 8.4 service, separate
storage volumes and unique credentials/APP_KEY. Only private database DNS and
internal port 3306 are permitted; no public TCP proxy or public database URL.
Manually migrate only the verified empty staging target after deployment
approval, then use interactive masked `staging:bootstrap-admin`; do not configure
ADMIN_PASSWORD or automatic seeding. Keep production/debug-off, secure encrypted
host-only cookies, the array-only email sink, private uploads and safe readiness.
Never copy real school records, addresses, documents or development secrets.

Keep public domains absent until a protected allowlisted identity/MFA gateway
covering HTML and API is reviewed, with no bypass origin and bearer headers
preserved. Disable automatic GitHub deployments and unapproved preview triggers
before source linking. Approve a budget, set compute alerts/hard limits and
CPU/memory caps, monitor spend/storage/restarts/errors, and use one replica with
no extra worker/Redis service. Native MySQL backups and private-file/key recovery
must be operator-controlled and restored to separate fixtures.
[Railway private networking](https://docs.railway.com/networking/private-networking),
[autodeploy controls](https://docs.railway.com/deployments/github-autodeploys),
[cost controls](https://docs.railway.com/pricing/cost-control).

Repository sanitization does not complete live remediation. Approve/review
historical publication handling and finish ACL/credential/runtime checkpoints
before GitHub synchronization or staging resources are authorized.
