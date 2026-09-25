#!/bin/bash
# P2-7 端到端验收（Spec §12 实跑）。用法: bash scripts/e2e_check.sh
set -u
cd "$(dirname "$0")/../backend"
export APP_DB_PATH="$(mktemp -d)/e2e.db"
export APP_LOG_FILE="" APP_LOG_LEVEL="WARNING" APP_SCHEDULER_DISABLED=1
export APP_SECRET_KEY="kQ0mZx2v8bN1sT4yL7rJ0cF6pW9aH3dE5gU2iO8nQ4k="
PASS=0; FAIL=0
check() {
  if echo "$3" | grep -q "$2"; then PASS=$((PASS+1)); echo "PASS $1";
  else FAIL=$((FAIL+1)); echo "FAIL $1 | got: $(echo "$3" | head -c 200)"; fi
}
./.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8022 > /tmp/e2e_uvicorn.log 2>&1 &
SRV=$!
for i in $(seq 1 20); do sleep 1; curl -s -o /dev/null http://127.0.0.1:8022/api/v1/health && break; done

H=http://127.0.0.1:8022
C="Content-Type: application/json"
check "1 health"              '"status":"ok"'        "$(curl -s $H/api/v1/health)"
check "2 capabilities strict" '"privacy_mode":"strict"' "$(curl -s $H/api/v1/capabilities)"
check "3 chat 4010"           '"code":4010'          "$(curl -s -X POST $H/api/v1/llm/chat -H "$C" -d '{"taskKey":"text_to_sql","messages":[{"role":"user","content":"hi"}]}')"
check "4 kb 4030 strict"      '"code":4030'          "$(curl -s -X POST $H/api/v1/knowledge-bases -H "$C" -d '{"name":"kb1"}')"
curl -s -X POST $H/api/v1/llm/providers -H "$C" -H "X-Local-Confirm: true" -d '{"name":"p1","baseUrl":"https://api.example.com","apiKey":"sk-E2ESECRET123","model":"m"}' > /dev/null
check "5 key masked"          'sk-\*\*\*'            "$(curl -s $H/api/v1/llm/providers)"
LEAK=$(curl -s $H/api/v1/llm/providers | grep -c "E2ESECRET")
check "6 no plaintext key"    '^0$'                  "$LEAK"
curl -s -X PUT $H/api/v1/settings/privacy-mode -H "$C" -H "X-Local-Confirm: true" -d '{"privacy_mode":"full"}' > /dev/null
check "7 switch full"         '"privacy_mode":"full"' "$(curl -s $H/api/v1/capabilities)"
DS=$(curl -s -X POST $H/api/v1/datasets -H "$C" -d '{"name":"e2e","storageMode":"server"}')
DSID=$(echo "$DS" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
check "8 register server"     '"storageMode":"server"' "$DS"
printf 'city,val\nSH,120\nBJ,95\n' > e2e_tmp.csv
UP=$(curl -s -X POST "$H/api/v1/datasets/$DSID/upload" -F "file=@e2e_tmp.csv;type=text/csv")
check "9 upload csv"          '"rowCount":2'          "$UP"
TABLE=$(echo "$UP" | grep -o '"serverTable":"[^"]*"' | cut -d'"' -f4)
SQL="{\"sql\":\"SELECT * FROM $TABLE\"}"
check "10 readonly sql"       '"rowCount":2'          "$(curl -s -X POST $H/api/v1/datasets/$DSID/query -H "$C" -d "$SQL")"
check "11 sql guard"          '被拦截'                "$(curl -s -X POST $H/api/v1/datasets/$DSID/query -H "$C" -d '{"sql":"DROP TABLE x"}')"
check "12 bad cron 4090"      '"code":4090'           "$(curl -s -X POST $H/api/v1/schedules -H "$C" -d '{"name":"t","jobType":"dataset_query","datasetId":"'$DSID'","cron":"bad"}')"
CHECK_SQL="{\"sql\":\"SELECT val FROM $TABLE ORDER BY val DESC\"}"
TOP=$(curl -s -X POST $H/api/v1/datasets/$DSID/query -H "$C" -d "$CHECK_SQL")
check "13 numeric order"      '"rows":\[\[120'        "$(echo "$TOP" | tr -d ' ')"
kill $SRV 2>/dev/null
echo "===== E2E RESULT: PASS=$PASS FAIL=$FAIL ====="
