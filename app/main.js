// Pinta3MF — app de janela (Electron): embrulha a página web, salva o .3mf com o diálogo nativo
// e oferece abrir o resultado no Bambu Studio.
const { app, BrowserWindow, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const PAGINA = [path.join(__dirname, 'Pinta3MF.html'), path.join(__dirname, '..', 'web', 'dist', 'Pinta3MF.html')].find(f => fs.existsSync(f));

function criarJanela() {
  const win = new BrowserWindow({ width: 1320, height: 880, minWidth: 900, minHeight: 600, title: 'Pinta3MF', autoHideMenuBar: true, backgroundColor: '#111111' });
  Menu.setApplicationMenu(null);
  win.on('page-title-updated', e => e.preventDefault());
  win.setTitle('Pinta3MF v' + app.getVersion());
  win.loadFile(PAGINA);
  // soltar um arquivo fora da área certa não pode navegar para ele
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:') || /\.(zip|obj|mtl|png|jpe?g)$/i.test(url)) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });

  win.webContents.session.on('will-download', (e, item) => {
    // o diálogo "Salvar como" nativo aparece sozinho (sem setSavePath); o nome já vem como <modelo>_pintado.3mf
    item.once('done', async (ev, estado) => {
      if (estado !== 'completed') return;
      const arq = item.getSavePath();
      const r = await dialog.showMessageBox(win, { type: 'info', title: 'Pinta3MF', message: 'O 3MF pintado foi salvo.', detail: arq, buttons: ['Abrir no Bambu Studio', 'Mostrar na pasta', 'Fechar'], defaultId: 0, cancelId: 2 });
      if (r.response === 0) { const erro = await shell.openPath(arq); if (erro) dialog.showErrorBox('Pinta3MF', 'Não consegui abrir o arquivo: ' + erro); }
      else if (r.response === 1) shell.showItemInFolder(arq);
    });
  });
}

// Atualização automática: a cada abertura consulta os Releases do GitHub; se houver versão nova baixa em segundo
// plano e pergunta se quer reiniciar (se não quiser agora, instala sozinha ao fechar o programa).
function configurarAtualizacao() {
  if (!app.isPackaged) return;
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', async info => {
    const r = await dialog.showMessageBox({ type: 'info', title: 'Pinta3MF', message: `Nova versão ${info.version} pronta.`, detail: 'Reiniciar agora para atualizar? Se escolher "Depois", ela é instalada quando você fechar o programa.', buttons: ['Reiniciar e atualizar', 'Depois'], defaultId: 0, cancelId: 1 });
    if (r.response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.on('error', e => console.error('Atualização:', e && e.message));
  autoUpdater.checkForUpdates().catch(e => console.error('Atualização:', e && e.message));
}

app.whenReady().then(() => {
  if (!PAGINA) { dialog.showErrorBox('Pinta3MF', 'Não achei Pinta3MF.html. Rode "python web/build.py" primeiro.'); app.quit(); return; }
  criarJanela();
  configurarAtualizacao();
});
app.on('window-all-closed', () => app.quit());
