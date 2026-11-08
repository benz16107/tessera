#!/bin/bash
# SpacetimeDB proof for the demo: live SQL over both Maincloud databases, the HTTP routes, and the module's log
# highlights. Read-only. Usage: scripts/demo.sh [database]   (default shotmatch; shotmatch-scratch has the proof runs)
db=${1:-shotmatch}
route=https://maincloud.spacetimedb.com/v1/database/$db/route
sql() { echo; echo "\$ spacetime sql $1 \"$2\""; spacetime sql --server maincloud "$1" "$2" 2>&1 | grep -v WARNING | head -"${3:-14}"; }
hr() { echo; echo "== $1"; }

hr "The demo session survives every publish"
sql "$db" "SELECT id, code, title, spot_id FROM session WHERE code = 'A9TVAN'"
hr "Everything a session is, as rows"
sql "$db" "SELECT COUNT(*) AS sessions FROM session"
sql "$db" "SELECT COUNT(*) AS scene_objects FROM scene_object"
sql "$db" "SELECT COUNT(*) AS history_rows FROM scene_change"
sql "$db" "SELECT session_id, role FROM session_member" 8
hr "Scene history (time travel and undo)"
sql "$db" "SELECT id, session_id, object_id, action, by_name FROM scene_change" 10
hr "Photon: the thread as a version tree over scene history"
sql "$db" "SELECT id, session_id, label, parent_version_id, scene_change_id, channel FROM shot_version" 10
sql "$db" "SELECT session_id, name, verdict, distance_m FROM checkin" 6
hr "Schedules running inside the database"
sql "$db" "SELECT * FROM sun_clock" 6
sql "$db" "SELECT scheduled_id, session_id FROM reminder" 6
hr "Procedure: Nemotron 3.5 Lightning titles a shoot from inside the database"
sql "$db" "SELECT session_id, result, ms FROM agent_step WHERE tool = 'nemotron_lightning.title_session'" 6
hr "Inter-database: shotmatch -> shotmatch-library (outbox + onResult)"
sql shotmatch-library "SELECT id, name, sessions FROM prop" 8
sql shotmatch-library "SELECT share_code, title, f_35 FROM shot" 8
sql shotmatch-library "SELECT label FROM trusted_db" 4
hr "HTTP handlers served by the module"
echo "\$ curl $route/health"; curl -s "$route/health"; echo
code=$(spacetime sql --server maincloud "$db" "SELECT share_code FROM public_shot WHERE state = 'published'" 2>/dev/null | grep -o '"[A-Z0-9]\{8\}"' | head -1 | tr -d '"')
if [ -n "$code" ]; then echo "\$ curl $route/shot?code=$code"; curl -s "$route/shot?code=$code"; echo; fi
echo "\$ curl -X POST $route/hooks/elevenlabs   (unsigned)"; curl -s -X POST -d '{}' "$route/hooks/elevenlabs"; echo
hr "Module log highlights (spacetime logs $db)"
spacetime logs --server maincloud "$db" -n 400 2>&1 | grep -v WARNING | grep -E "title_session|idc |presence_sweep|sweep:|hooks/elevenlabs|panic|error" | tail -12
