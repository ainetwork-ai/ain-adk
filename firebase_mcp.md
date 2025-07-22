firebase cli

npx firebase login --no-localhost (로컬)
npm install --save-dev firebase-tools (원격)

screen -dmS unblockAgent \
  bash -lc 'cd ~/unblock-agent && npx tsx index.ts > ~/unblock-agent/unblock-agent.log 2>&1'

tail -f ~/unblock-agent/unblock-agent.log

screen -r unblockAgent