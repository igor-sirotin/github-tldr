const DEFAULTS = {
  openaiKey: '',
  openaiModel: 'gpt-4o-mini',
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

document.getElementById('save').addEventListener('click', async () => {
  await chrome.storage.local.set({
    openaiKey: key.value.trim(),
    openaiModel: model.value.trim() || DEFAULTS.openaiModel,
    openaiBaseUrl: base.value.trim() || DEFAULTS.openaiBaseUrl,
  });
  status.textContent = 'Saved';
  setTimeout(() => (status.textContent = ''), 1500);
});
