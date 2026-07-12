#!/usr/bin/env bash
# nginx-config-helper.sh
# Called via sudo by the rproxy app. Performs validated file operations on
# nginx config directories. All arguments are strictly validated here before
# any filesystem operation — never trust caller input.
#
# This is the SOURCE copy. The copy that actually runs as root is installed
# by setup.sh to /usr/local/libexec/rproxy-nginx-helper (root:root, 0700),
# outside the rproxy-writable checkout. Editing this file has no effect on
# production until an admin re-runs setup.sh (as root) to refresh that copy.

set -euo pipefail

SITES_AVAILABLE="/etc/nginx/sites-available"
SITES_ENABLED="/etc/nginx/sites-enabled"
SSL_DIR="/etc/nginx/ssl"
STAGING_DIR="/var/lib/rproxy/staging"

# Validate that a filename is a safe .conf name (no path traversal)
validate_conf_filename() {
  local name="$1"
  if [[ ! "$name" =~ ^[a-zA-Z0-9._-]+\.conf$ ]]; then
    echo "ERROR: Invalid config filename: $name" >&2
    exit 1
  fi
  if [[ "$name" == *".."* ]]; then
    echo "ERROR: Path traversal detected" >&2
    exit 1
  fi
}

# Validate that a path is within an allowed directory
validate_path_in_dir() {
  local file="$1"
  local dir="$2"
  local real
  # -s (--no-symlinks / --strip) only resolves "." and ".." lexically and
  # does NOT dereference symlinks. Every entry in sites-enabled is itself a
  # symlink into sites-available by design — plain `realpath -m` follows
  # that symlink before the containment check, so it always resolves to
  # sites-available and this check would reject every legitimate
  # sites-enabled path (breaking `disable`/`remove` for every site).
  real="$(realpath -sm "$file")"
  if [[ "$real" != "$dir/"* ]]; then
    echo "ERROR: Path $file is outside $dir" >&2
    exit 1
  fi
}

CMD="${1:-}"

case "$CMD" in

  deploy)
    # Usage: deploy <filename.conf>
    # Copies from staging to sites-available, atomically (temp file + rename
    # within the same directory) so a concurrent nginx -t/reload never sees
    # a partially written file.
    FILENAME="${2:-}"
    validate_conf_filename "$FILENAME"
    SRC="$STAGING_DIR/$FILENAME"
    DST="$SITES_AVAILABLE/$FILENAME"
    validate_path_in_dir "$SRC" "$STAGING_DIR"
    validate_path_in_dir "$DST" "$SITES_AVAILABLE"
    if [[ ! -f "$SRC" ]]; then
      echo "ERROR: Staging file not found: $SRC" >&2
      exit 1
    fi
    cp -- "$SRC" "$DST.tmp.$$"
    mv -f -- "$DST.tmp.$$" "$DST"
    echo "OK: deployed $FILENAME to $SITES_AVAILABLE"
    ;;

  backup)
    # Usage: backup <filename.conf>
    # Snapshots the current sites-available content (if any) and whether the
    # site is currently enabled, so a failed deploy can be rolled back with
    # `restore`. Call this before `deploy` in a deploy transaction.
    FILENAME="${2:-}"
    validate_conf_filename "$FILENAME"
    AVAILABLE="$SITES_AVAILABLE/$FILENAME"
    validate_path_in_dir "$AVAILABLE" "$SITES_AVAILABLE"
    mkdir -p "$STAGING_DIR"
    if [[ -f "$AVAILABLE" ]]; then
      cp -- "$AVAILABLE" "$STAGING_DIR/${FILENAME}.bak"
    else
      rm -f -- "$STAGING_DIR/${FILENAME}.bak"
    fi
    if [[ -L "$SITES_ENABLED/$FILENAME" ]]; then
      : > "$STAGING_DIR/${FILENAME}.was-enabled"
    else
      rm -f -- "$STAGING_DIR/${FILENAME}.was-enabled"
    fi
    echo "OK: backed up $FILENAME"
    ;;

  restore)
    # Usage: restore <filename.conf>
    # Reverts sites-available/sites-enabled to the state captured by the
    # most recent `backup` for this filename. If there was no prior config
    # (a brand-new site), removes it entirely instead.
    FILENAME="${2:-}"
    validate_conf_filename "$FILENAME"
    AVAILABLE="$SITES_AVAILABLE/$FILENAME"
    ENABLED="$SITES_ENABLED/$FILENAME"
    validate_path_in_dir "$AVAILABLE" "$SITES_AVAILABLE"
    validate_path_in_dir "$ENABLED" "$SITES_ENABLED"
    BAK="$STAGING_DIR/${FILENAME}.bak"
    if [[ -f "$BAK" ]]; then
      cp -- "$BAK" "$AVAILABLE.tmp.$$"
      mv -f -- "$AVAILABLE.tmp.$$" "$AVAILABLE"
      rm -f -- "$BAK"
    else
      rm -f -- "$AVAILABLE"
    fi
    if [[ -f "$STAGING_DIR/${FILENAME}.was-enabled" ]]; then
      ln -sf "$AVAILABLE" "$ENABLED"
      rm -f -- "$STAGING_DIR/${FILENAME}.was-enabled"
    else
      rm -f -- "$ENABLED"
    fi
    echo "OK: restored $FILENAME"
    ;;

  enable)
    # Usage: enable <filename.conf>
    FILENAME="${2:-}"
    validate_conf_filename "$FILENAME"
    SRC="$SITES_AVAILABLE/$FILENAME"
    DST="$SITES_ENABLED/$FILENAME"
    validate_path_in_dir "$SRC" "$SITES_AVAILABLE"
    validate_path_in_dir "$DST" "$SITES_ENABLED"
    if [[ ! -f "$SRC" ]]; then
      echo "ERROR: Config not in sites-available: $SRC" >&2
      exit 1
    fi
    ln -sf "$SRC" "$DST"
    echo "OK: enabled $FILENAME"
    ;;

  disable)
    # Usage: disable <filename.conf>
    FILENAME="${2:-}"
    validate_conf_filename "$FILENAME"
    DST="$SITES_ENABLED/$FILENAME"
    validate_path_in_dir "$DST" "$SITES_ENABLED"
    rm -f -- "$DST"
    echo "OK: disabled $FILENAME"
    ;;

  remove)
    # Usage: remove <filename.conf>
    # Removes from both sites-enabled and sites-available
    FILENAME="${2:-}"
    validate_conf_filename "$FILENAME"
    ENABLED="$SITES_ENABLED/$FILENAME"
    AVAILABLE="$SITES_AVAILABLE/$FILENAME"
    validate_path_in_dir "$ENABLED" "$SITES_ENABLED"
    validate_path_in_dir "$AVAILABLE" "$SITES_AVAILABLE"
    rm -f -- "$ENABLED"
    rm -f -- "$AVAILABLE"
    echo "OK: removed $FILENAME"
    ;;

  mkdir-ssl)
    # Usage: mkdir-ssl
    mkdir -p "$SSL_DIR"
    chown "rproxy:rproxy" "$SSL_DIR"
    chmod 755 "$SSL_DIR"
    echo "OK: $SSL_DIR ready"
    ;;

  mkdir-access-lists)
    mkdir -p /etc/nginx/access-lists
    chown root:www-data /etc/nginx/access-lists
    chmod 750 /etc/nginx/access-lists
    echo "OK: /etc/nginx/access-lists ready"
    ;;

  deploy-htpasswd)
    ID="${2:-}"
    if [[ ! "$ID" =~ ^[a-z0-9]+$ ]]; then
        echo "ERROR: Invalid access list id" >&2
        exit 1
    fi
    SRC="$STAGING_DIR/${ID}.htpasswd"
    DST="/etc/nginx/access-lists/${ID}.htpasswd"
    if [[ ! -f "$SRC" ]]; then
        echo "ERROR: Staging file not found: $SRC" >&2
        exit 1
    fi
    mkdir -p /etc/nginx/access-lists
    cp -- "$SRC" "$DST"
    chown root:www-data "$DST"
    chmod 640 "$DST"
    echo "OK: htpasswd deployed for $ID"
    ;;

  remove-htpasswd)
    ID="${2:-}"
    if [[ ! "$ID" =~ ^[a-z0-9]+$ ]]; then
        echo "ERROR: Invalid access list id" >&2
        exit 1
    fi
    rm -f -- "/etc/nginx/access-lists/${ID}.htpasswd"
    echo "OK: htpasswd removed for $ID"
    ;;



  stream-deploy)
    # Usage: stream-deploy <filename.conf>
    FILENAME="${2:-}"
    validate_conf_filename "$FILENAME"
    SRC="$STAGING_DIR/$FILENAME"
    DST="/etc/nginx/stream.d/$FILENAME"
    validate_path_in_dir "$SRC" "$STAGING_DIR"
    if [[ "$( realpath -m "$DST" )" != "/etc/nginx/stream.d/"* ]]; then
      echo "ERROR: Path outside stream.d" >&2; exit 1
    fi
    if [[ ! -f "$SRC" ]]; then
      echo "ERROR: Staging file not found: $SRC" >&2; exit 1
    fi
    cp -- "$SRC" "$DST.tmp.$$"
    mv -f -- "$DST.tmp.$$" "$DST"
    echo "OK: stream-deployed $FILENAME"
    ;;

  stream-remove)
    # Usage: stream-remove <filename.conf>
    FILENAME="${2:-}"
    validate_conf_filename "$FILENAME"
    DST="/etc/nginx/stream.d/$FILENAME"
    if [[ "$(realpath -m "$DST")" != "/etc/nginx/stream.d/"* ]]; then
      echo "ERROR: Path outside stream.d" >&2; exit 1
    fi
    rm -f -- "$DST"
    echo "OK: stream-removed $FILENAME"
    ;;

  stream-backup)
    # Usage: stream-backup <filename.conf>
    FILENAME="${2:-}"
    validate_conf_filename "$FILENAME"
    DST="/etc/nginx/stream.d/$FILENAME"
    if [[ "$(realpath -m "$DST")" != "/etc/nginx/stream.d/"* ]]; then
      echo "ERROR: Path outside stream.d" >&2; exit 1
    fi
    mkdir -p "$STAGING_DIR"
    if [[ -f "$DST" ]]; then
      cp -- "$DST" "$STAGING_DIR/${FILENAME}.stream.bak"
    else
      rm -f -- "$STAGING_DIR/${FILENAME}.stream.bak"
    fi
    echo "OK: backed up stream $FILENAME"
    ;;

  stream-restore)
    # Usage: stream-restore <filename.conf>
    FILENAME="${2:-}"
    validate_conf_filename "$FILENAME"
    DST="/etc/nginx/stream.d/$FILENAME"
    if [[ "$(realpath -m "$DST")" != "/etc/nginx/stream.d/"* ]]; then
      echo "ERROR: Path outside stream.d" >&2; exit 1
    fi
    BAK="$STAGING_DIR/${FILENAME}.stream.bak"
    if [[ -f "$BAK" ]]; then
      cp -- "$BAK" "$DST.tmp.$$"
      mv -f -- "$DST.tmp.$$" "$DST"
      rm -f -- "$BAK"
    else
      rm -f -- "$DST"
    fi
    echo "OK: restored stream $FILENAME"
    ;;

  mkdir-stream)
    mkdir -p /etc/nginx/stream.d
    chown root:root /etc/nginx/stream.d
    chmod 755 /etc/nginx/stream.d
    echo "OK: /etc/nginx/stream.d ready"
    ;;

  log-size)
    total=0
    for dir in /var/log/nginx /var/log/rproxy; do
        [[ -d "$dir" ]] || continue
        sz=$(du -sb "$dir" 2>/dev/null | awk '{print $1}')
        total=$((total + ${sz:-0}))
    done
    echo "$total"
    ;;

  log-clean)
    MAX_BYTES="${2:-}"
    if [[ ! "$MAX_BYTES" =~ ^[0-9]+$ ]]; then
        echo "ERROR: log-clean requires a numeric max_bytes argument" >&2
        exit 1
    fi
    # Remove rotated/compressed logs oldest-first until under limit
    while true; do
        total=0
        for dir in /var/log/nginx /var/log/rproxy; do
            [[ -d "$dir" ]] || continue
            sz=$(du -sb "$dir" 2>/dev/null | awk '{print $1}')
            total=$((total + ${sz:-0}))
        done
        [[ $total -le $MAX_BYTES ]] && break
        oldest=$(find /var/log/nginx /var/log/rproxy -maxdepth 1 -type f \
            \( -name "*.log.[0-9]*" -o -name "*.log.gz" \) \
            -printf "%T@ %p\n" 2>/dev/null | sort -n | head -1 | cut -d' ' -f2-)
        [[ -z "$oldest" ]] && break
        rm -f -- "$oldest"
    done
    # If still over limit, truncate active .log files
    total=0
    for dir in /var/log/nginx /var/log/rproxy; do
        [[ -d "$dir" ]] || continue
        sz=$(du -sb "$dir" 2>/dev/null | awk '{print $1}')
        total=$((total + ${sz:-0}))
    done
    if [[ $total -gt $MAX_BYTES ]]; then
        find /var/log/nginx /var/log/rproxy -maxdepth 1 -type f -name "*.log" \
            -exec truncate --size=0 {} \;
    fi
    final=0
    for dir in /var/log/nginx /var/log/rproxy; do
        [[ -d "$dir" ]] || continue
        sz=$(du -sb "$dir" 2>/dev/null | awk '{print $1}')
        final=$((final + ${sz:-0}))
    done
    echo "OK: $final"
    ;;


  *)
    echo "ERROR: Unknown command: $CMD" >&2
    echo "Usage: $0 {deploy|backup|restore|enable|disable|remove|mkdir-ssl|stream-deploy|stream-backup|stream-restore|stream-remove} [filename.conf]" >&2
    exit 1
    ;;
esac
