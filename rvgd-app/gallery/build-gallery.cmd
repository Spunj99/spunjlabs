@echo off
rem Double-click after adding photos to a rvgd-<number> folder.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-gallery.ps1"
pause
