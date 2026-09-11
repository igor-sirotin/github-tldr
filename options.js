const DEFAULTS = {
  openaiKey: '',
  openaiModel: 'gpt-5.6-luna',
  openaiBaseUrl: 'https://api.openai.com/v1',
};

const key = document.getElementById('key');
const model = document.getElementById('model');
const base = document.getElementById('base');
const status = document.getElementById('status');

chrome.storage.local.get(Object.keys(DEFAULTS)).then((stored) => {
  const s = { ...DEFAULTS, ...stored };
  key.value = s.openaiKey;
  model.value = s.openaiModel;
  base.value = s.openaiBaseUrl;
});

const cacheInfo = document.getElementById('cacheInfo');

async function showCacheSize() {
  const { tldrCache } = await chrome.storage.local.get('tldrCache');
  const n = tldrCache ? Object.keys(tldrCache).length : 0;
  cacheInfo.textContent =
    n === 0
      ? 'Nothing cached yet. Summaries are reused until a comment is edited.'
      : `${n} summary${n === 1 ? '' : 's'} cached and reused until the comment is edited.`;
}

showCacheSize();

document.getElementById('clear').addEventListener('click', async () => {
  await chrome.storage.local.remove('tldrCache');
  showCacheSize();
});

document.getElementById('save').addEventListener('click', async () => {
  await chrome.storage.local.set({
    openaiKey: key.value.trim(),
    openaiModel: model.value.trim() || DEFAULTS.openaiModel,
    openaiBaseUrl: base.value.trim() || DEFAULTS.openaiBaseUrl,
  });
  status.textContent = 'Saved';
  setTimeout(() => (status.textContent = ''), 1500);
});
