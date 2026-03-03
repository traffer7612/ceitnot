@echo off
REM Deploy to Anvil. Run "anvil" in another window first.
cd /d "%~dp0\.."

set NO_PROXY=localhost,127.0.0.1
set HTTP_PROXY=
set HTTPS_PROXY=

echo Deploying to Anvil at http://127.0.0.1:8545 ...
forge script script/Deploy.s.sol:DeployScript --rpc-url "http://127.0.0.1:8545" --broadcast --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
if errorlevel 1 (
    echo.
    echo Start Anvil in another terminal: anvil
    exit /b 1
)
echo.
echo Copy AURA_ENGINE_ADDRESS=0x... from output above into backend\.env
pause
