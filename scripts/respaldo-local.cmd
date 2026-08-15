@echo off
REM Copia local diaria de los respaldos de CORPUNISOUND.
REM La corre la tarea programada CORPUNISOUND-Respaldo-Local.
cd /d "%~dp0"
node respaldo-local.mjs >> "%~dp0respaldo-local.log" 2>&1
