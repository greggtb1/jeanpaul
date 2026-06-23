Place les installateurs ici — servis en live sur :
  https://blowmyjob.fr/downloads/agent/<fichier>

Fichiers attendus :
  - BLOW-MY-JOB-Agent_aarch64.dmg
  - BLOW-MY-JOB-Agent_x64.dmg
  - BLOW-MY-JOB-Agent_x64-setup.exe

Build Windows :
  - GitHub Actions > Build BLOW MY JOB Agent
  - ou sur Windows : powershell -ExecutionPolicy Bypass -File desktop/scripts/build-windows.ps1

Upload prod :
  bash scripts/upload-agent-to-hostinger.sh
