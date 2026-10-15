@echo off
rem Arranque para el Programador de tareas. La configuracion vive FUERA de esta carpeta.
if "%SICAR_CONFIG%"=="" set "SICAR_CONFIG=C:\UnisoundSICAR\config.json"
node "%~dp0index.js" %*
