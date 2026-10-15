#!/bin/bash
# FBS Texts installer. In Terminal on the Mac signed in to Messages:
#   curl -fsSL https://portal.fbsprint.com/texts/install.sh | bash -s -- <setup code from the portal>
# Installs into ~/Library/Application Support/FBSTexts (no admin password), runs every 2 minutes. Remove with:
#   launchctl bootout gui/$(id -u)/com.fbsprint.texts; rm -rf ~/Library/Application\ Support/FBSTexts ~/Library/LaunchAgents/com.fbsprint.texts.plist
set -e
TOKEN="$1"; URL="${2:-https://portal.fbsprint.com}"
case "$TOKEN" in fbst_*) ;; *) echo "Run it with the setup code from the portal (Settings > Texts)."; exit 1 ;; esac
DIR="$HOME/Library/Application Support/FBSTexts"
APP="$DIR/FBS Texts.app"
PLIST="$HOME/Library/LaunchAgents/com.fbsprint.texts.plist"
mkdir -p "$DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
umask 077
printf 'TOKEN=%s\nURL=%s\n' "$TOKEN" "$URL" > "$DIR/config"
curl -fsSL "$URL/texts/sync.sh" -o "$DIR/sync.sh"
chmod 700 "$DIR/sync.sh"
# a small app around the script, so Full Disk Access goes to it alone (not to Terminal or bash)
rm -rf "$APP"
osacompile -o "$APP" -e "do shell script \"/bin/bash \" & quoted form of \"$DIR/sync.sh\""
/usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$APP/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.fbsprint.texts" "$APP/Contents/Info.plist" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string com.fbsprint.texts" "$APP/Contents/Info.plist"
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.fbsprint.texts</string>
  <key>ProgramArguments</key><array><string>$APP/Contents/MacOS/applet</string></array>
  <key>StartInterval</key><integer>120</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/com.fbsprint.texts" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo
echo "FBS Texts is installed. One more step:"
echo "  System Settings > Privacy & Security > Full Disk Access > +  and add \"FBS Texts\" (the Finder window that just opened)."
echo "Then it sends the customers' texts every 2 minutes. Log: ~/Library/Logs/FBSTexts.log"
open -R "$APP"
open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles" || true
