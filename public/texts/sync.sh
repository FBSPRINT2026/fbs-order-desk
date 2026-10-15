#!/bin/bash
# FBS Texts: sends this Mac's texts with FBS Print customers to the portal (portal.fbsprint.com).
# Runs every 2 minutes (LaunchAgent com.fbsprint.texts). Asks the portal which numbers and emails are customers',
# reads only those conversations from Messages (read only), and sends them with their pictures. Personal texts stay
# on this Mac. Needs Full Disk Access for "FBS Texts" (System Settings > Privacy & Security > Full Disk Access).
# macOS bash 3.2 on purpose: no jq, no Homebrew.

DIR="$HOME/Library/Application Support/FBSTexts"
LOG="$HOME/Library/Logs/FBSTexts.log"
DB="$HOME/Library/Messages/chat.db"
. "$DIR/config" || exit 1          # TOKEN=… URL=…
cd "$DIR" || exit 1
[ -f "$LOG" ] && [ "$(stat -f%z "$LOG")" -gt 1000000 ] && mv -f "$LOG" "$LOG.1"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }
api() { curl -fsS --max-time 120 -H "Authorization: Bearer $TOKEN" "$@"; }
say_error() { log "ERROR $1"; api -X POST -H 'Content-Type: application/json' --data-binary "{\"error\":\"$1\"}" "$URL/api/texts/ingest" >/dev/null 2>&1; }

# Messages' database: needs Full Disk Access
if ! sqlite3 -readonly "$DB" "select 1" >/dev/null 2>&1; then
  say_error "Can't read Messages: give FBS Texts Full Disk Access (System Settings > Privacy & Security > Full Disk Access)."
  exit 0
fi

# 1. the customers' numbers and emails (first line: "v <version>")
api "$URL/api/texts/handles" -o handles.new || { log "handles: portal didn't answer"; exit 0; }
V=$(head -1 handles.new | sed 's/^v //')
tail -n +2 handles.new | tr 'A-Z' 'a-z' | sort -u > forms.new
[ -s forms.new ] || { log "no customer numbers yet"; exit 0; }
sqllist() { sed "s/'/''/g; s/.*/'&'/" "$1" | paste -sd, -; }

LAST=$(cat last 2>/dev/null || echo 0)

# the texts in conversations with these numbers, after a row, oldest first
query() { # $1 list, $2 after rowid, $3 up to rowid (0 = no limit)
  local upto=""; [ "$3" != "0" ] && upto="AND m.ROWID <= $3"
  sqlite3 -readonly -json "$DB" "
WITH cc AS (SELECT DISTINCT chj.chat_id FROM chat_handle_join chj JOIN handle hh ON hh.ROWID = chj.handle_id WHERE lower(hh.id) IN ($1))
SELECT m.ROWID AS rowid, m.guid, m.text, hex(m.attributedBody) AS hex, m.is_from_me AS from_me, m.date, m.service,
  COALESCE(h.id, '') AS handle, COALESCE(c.chat_identifier, '') AS chat, COALESCE(c.display_name, '') AS chat_name,
  (SELECT group_concat(hh.id) FROM chat_handle_join chj JOIN handle hh ON hh.ROWID = chj.handle_id WHERE chj.chat_id = c.ROWID) AS parts,
  (SELECT json_group_array(json_object('id', a.ROWID, 'name', COALESCE(a.transfer_name, ''), 'mime', COALESCE(a.mime_type, ''), 'size', a.total_bytes))
     FROM message_attachment_join maj JOIN attachment a ON a.ROWID = maj.attachment_id WHERE maj.message_id = m.ROWID) AS files
FROM message m
JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
JOIN chat c ON c.ROWID = cmj.chat_id
LEFT JOIN handle h ON h.ROWID = m.handle_id
WHERE m.ROWID > $2 $upto AND cmj.chat_id IN (SELECT chat_id FROM cc) AND COALESCE(m.associated_message_type, 0) = 0
ORDER BY m.ROWID LIMIT 200;"
}

# send a batch; the portal answers with the pictures it wants ("guid<TAB>attachment id" lines)
send() { # $1 json file, $2 rowid to remember (or "" for older texts)
  { printf '{"rowid":%s,"backfill":%s,"handles_v":"%s","messages":' "${2:-0}" "$([ -z "$2" ] && echo true || echo false)" "$V"; cat "$1"; printf '}'; } > batch.json
  api -X POST -H 'Content-Type: application/json' --data-binary @batch.json "$URL/api/texts/ingest?fmt=lines" -o want.txt || { log "ingest failed"; return 1; }
  while IFS=$'\t' read -r guid aid; do
    [ -n "$aid" ] || continue
    f=$(sqlite3 -readonly "$DB" "SELECT filename FROM attachment WHERE ROWID = $aid")
    f="${f/#\~/$HOME}"
    [ -f "$f" ] || { log "picture not on this Mac (iCloud only?): $aid"; continue; }
    up="$f"; name=$(basename "$f"); type=""
    case "$(echo "$name" | tr 'A-Z' 'a-z')" in
      *.heic|*.heif|*.tif|*.tiff) sips -s format jpeg -Z 2400 "$f" --out up.jpg >/dev/null 2>&1 && up="$DIR/up.jpg" && name="${name%.*}.jpg" && type="image/jpeg" ;;
    esac
    api -X POST -F "guid=$guid" -F "id=$aid" -F "name=$name" -F "type=$type" -F "file=@$up" "$URL/api/texts/file" >/dev/null || log "upload failed: $aid"
  done < want.txt
  return 0
}

# 2. customers added since last time: their older texts too
touch forms.old
comm -13 forms.old forms.new > forms.added
if [ -s forms.added ] && [ "$LAST" != "0" ]; then
  LIST=$(sqllist forms.added); AFTER=0
  while :; do
    query "$LIST" "$AFTER" "$LAST" > page.json || break
    [ -s page.json ] || break
    send page.json "" || exit 0
    AFTER=$(grep -o '"rowid":[0-9]*' page.json | tail -1 | cut -d: -f2)
    [ "$(grep -o '"rowid":' page.json | wc -l)" -lt 200 ] && break
  done
  log "older texts for $(wc -l < forms.added | tr -d ' ') new customer numbers/emails"
fi
cp forms.new forms.old

# 3. new texts since last time
LIST=$(sqllist forms.new)
TOP=$(sqlite3 -readonly "$DB" "SELECT COALESCE(MAX(ROWID), 0) FROM message")
while :; do
  query "$LIST" "$LAST" "$TOP" > page.json || { say_error "Couldn't read Messages."; exit 0; }
  if [ ! -s page.json ]; then
    echo "[]" > page.json; send page.json "$TOP" >/dev/null; echo "$TOP" > last; break
  fi
  N=$(grep -o '"rowid":' page.json | wc -l | tr -d ' ')
  R=$(grep -o '"rowid":[0-9]*' page.json | tail -1 | cut -d: -f2)
  [ "$N" -lt 200 ] && R=$TOP
  send page.json "$R" || exit 0
  echo "$R" > last; LAST=$R
  log "sent $N texts (through $R)"
  [ "$N" -lt 200 ] && break
done
rm -f page.json batch.json want.txt up.jpg handles.new
