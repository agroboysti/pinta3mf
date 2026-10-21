@echo off
chcp 65001 >nul
title Pinta3MF
rem Arraste em cima deste arquivo: um modelo (.zip ou .obj), varios modelos, ou uma PASTA cheia de modelos.
rem O .3mf pintado sai ao lado do modelo; no caso de uma pasta, na subpasta "pintados".
if "%~1"=="" (
  echo Arraste um modelo ^(.zip ou .obj^), varios modelos ou uma pasta em cima deste arquivo.
  echo Opcoes extras: veja "node cli\pinta3mf.js --ajuda"
  echo.
  pause
  exit /b 1
)
node "%~dp0cli\pinta3mf.js" %* --abrir
echo.
pause
