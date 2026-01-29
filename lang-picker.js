/**
 * Shared Language Picker Component
 * 
 * Usage:
 * 1. Include lang-picker.css
 * 2. Include lang-picker.js
 * 3. Call: createLangPicker(document.body, { languages, onLanguageChange })
 * 
 * Returns the current language code.
 */

const LANG_STORAGE_KEY = 'walletmemo-lang';

const DEFAULT_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'zh', label: '中文' }
];

function createLangPicker(container, options = {}) {
  const languages = options.languages || DEFAULT_LANGUAGES;
  const onLanguageChange = options.onLanguageChange || (() => {});

  // Detect initial language
  const stored = localStorage.getItem(LANG_STORAGE_KEY);
  const browserLang = (navigator.language || navigator.userLanguage || 'en').split('-')[0];
  let currentLang = stored || (languages.find(l => l.code === browserLang) ? browserLang : 'en');

  // Build HTML
  const picker = document.createElement('div');
  picker.className = 'lang-picker';
  picker.id = 'lang-picker';
  picker.innerHTML = `
    <button class="lang-btn" id="lang-btn">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="12" cy="12" r="10"/>
        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
      <span id="current-lang">${currentLang.toUpperCase()}</span>
      <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M6 9l6 6 6-6"/>
      </svg>
    </button>
    <div class="lang-dropdown" id="lang-dropdown">
      ${languages.map(l => `
        <button class="lang-option${l.code === currentLang ? ' active' : ''}" data-lang="${l.code}">
          ${l.label}
        </button>
      `).join('')}
    </div>
  `;

  container.appendChild(picker);

  // Wire up events
  const btn = picker.querySelector('.lang-btn');
  const dropdown = picker.querySelector('.lang-dropdown');
  const currentLabel = picker.querySelector('#current-lang');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    picker.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    if (!picker.contains(e.target)) {
      picker.classList.remove('open');
    }
  });

  picker.querySelectorAll('.lang-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const lang = opt.dataset.lang;
      currentLang = lang;
      localStorage.setItem(LANG_STORAGE_KEY, lang);
      currentLabel.textContent = lang.toUpperCase();
      
      // Update active state
      picker.querySelectorAll('.lang-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      picker.classList.remove('open');

      onLanguageChange(lang);
    });
  });

  // Return initial language and a setter
  return {
    getCurrentLang: () => currentLang,
    setLang: (lang) => {
      currentLang = lang;
      currentLabel.textContent = lang.toUpperCase();
      picker.querySelectorAll('.lang-option').forEach(o => {
        o.classList.toggle('active', o.dataset.lang === lang);
      });
      localStorage.setItem(LANG_STORAGE_KEY, lang);
      onLanguageChange(lang);
    }
  };
}
