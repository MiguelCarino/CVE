// i18n — CVE Radar Pro. Fleet convention (see Topo/js/i18n.js): English source
// strings ARE the keys, so a missing entry falls back to English. Locale comes
// from carino-lang.js (window.CarinoLang.current); this script is deferred and
// placed after it, so CarinoLang exists by DOMContentLoaded. Reacts to the
// fleet 'carino:langchange' event. Quick-search tags (product names), CVE data
// and the "CVE Radar Pro" app name stay English on purpose; the API status
// line is translated and re-mapped on switch (see applyStatusI18n).

const I18N = {
    es: {
        'Late shift.': 'Turno nocturno.',
        'Good morning.': 'Buenos días.',
        'Good afternoon.': 'Buenas tardes.',
        'Good evening.': 'Buenas noches.',
        // Sidebar filters
        'Quick Search': 'Búsqueda rápida',
        'Keyword': 'Palabra clave',
        'Product, Vendor, or Keyword...': 'Producto, fabricante o palabra clave...',
        'Timeframe': 'Período',
        'Last 7 Days': 'Últimos 7 días',
        'Last 30 Days': 'Últimos 30 días',
        'Last 90 Days': 'Últimos 90 días',
        'Year 2026': 'Año 2026',
        'Year 2025': 'Año 2025',
        'Year 2024': 'Año 2024',
        'All Time (Slow)': 'Todo el histórico (lento)',
        'Minimum Severity': 'Gravedad mínima',
        'Any (Includes Unrated)': 'Cualquiera (incluye sin puntuar)',
        'Low+': 'Baja+',
        'Medium+': 'Media+',
        'High+': 'Alta+',
        'Critical': 'Crítica',
        'Search Database': 'Buscar en la base de datos',
        // Results header
        '0 Results': '0 resultados',
        'Results Shown': 'resultados mostrados',
        'Sort By:': 'Ordenar por:',
        'Date (Newest First)': 'Fecha (más recientes primero)',
        'Date (Oldest First)': 'Fecha (más antiguas primero)',
        'Score (High to Low)': 'Puntuación (de mayor a menor)',
        'Score (Low to High)': 'Puntuación (de menor a mayor)',
        // Status line + errors
        'Fetching...': 'Consultando...',
        'NVD API Connected': 'API de NVD conectada',
        'API Error': 'Error de API',
        'Connection Error': 'Error de conexión',
        'Could not retrieve data from NIST. Please wait a moment and try again.': 'No se pudieron obtener datos del NIST. Espera un momento y vuelve a intentarlo.',
        'No matching CVEs found.': 'No se encontraron CVE que coincidan.',
        // CVE cards
        'Published:': 'Publicado:',
        'Updated:': 'Actualizado:',
        'PENDING': 'PENDIENTE',
        'Click to expand': 'Haz clic para expandir',
    },
    'pt-BR': {
        'Late shift.': 'Turno da noite.',
        'Good morning.': 'Bom dia.',
        'Good afternoon.': 'Boa tarde.',
        'Good evening.': 'Boa noite.',
        'Quick Search': 'Busca rápida',
        'Keyword': 'Palavra-chave',
        'Product, Vendor, or Keyword...': 'Produto, fornecedor ou palavra-chave...',
        'Timeframe': 'Período',
        'Last 7 Days': 'Últimos 7 dias',
        'Last 30 Days': 'Últimos 30 dias',
        'Last 90 Days': 'Últimos 90 dias',
        'Year 2026': 'Ano 2026',
        'Year 2025': 'Ano 2025',
        'Year 2024': 'Ano 2024',
        'All Time (Slow)': 'Todo o histórico (lento)',
        'Minimum Severity': 'Gravidade mínima',
        'Any (Includes Unrated)': 'Qualquer (inclui sem nota)',
        'Low+': 'Baixa+',
        'Medium+': 'Média+',
        'High+': 'Alta+',
        'Critical': 'Crítica',
        'Search Database': 'Pesquisar no banco de dados',
        '0 Results': '0 resultados',
        'Results Shown': 'resultados exibidos',
        'Sort By:': 'Ordenar por:',
        'Date (Newest First)': 'Data (mais recentes primeiro)',
        'Date (Oldest First)': 'Data (mais antigas primeiro)',
        'Score (High to Low)': 'Pontuação (da maior para a menor)',
        'Score (Low to High)': 'Pontuação (da menor para a maior)',
        'Fetching...': 'Buscando...',
        'NVD API Connected': 'API do NVD conectada',
        'API Error': 'Erro de API',
        'Connection Error': 'Erro de conexão',
        'Could not retrieve data from NIST. Please wait a moment and try again.': 'Não foi possível obter dados do NIST. Aguarde um momento e tente novamente.',
        'No matching CVEs found.': 'Nenhum CVE correspondente encontrado.',
        'Published:': 'Publicado:',
        'Updated:': 'Atualizado:',
        'PENDING': 'PENDENTE',
        'Click to expand': 'Clique para expandir',
    },
    ja: {
        'Late shift.': '夜勤お疲れさま。',
        'Good morning.': 'おはようございます。',
        'Good afternoon.': 'こんにちは。',
        'Good evening.': 'こんばんは。',
        'Quick Search': 'クイック検索',
        'Keyword': 'キーワード',
        'Product, Vendor, or Keyword...': '製品名・ベンダー名・キーワード...',
        'Timeframe': '期間',
        'Last 7 Days': '過去7日間',
        'Last 30 Days': '過去30日間',
        'Last 90 Days': '過去90日間',
        'Year 2026': '2026年',
        'Year 2025': '2025年',
        'Year 2024': '2024年',
        'All Time (Slow)': '全期間（低速）',
        'Minimum Severity': '最低深刻度',
        'Any (Includes Unrated)': 'すべて（未評価を含む）',
        'Low+': '低以上',
        'Medium+': '中以上',
        'High+': '高以上',
        'Critical': '緊急',
        'Search Database': 'データベースを検索',
        '0 Results': '0件',
        'Results Shown': '件を表示',
        'Sort By:': '並び替え:',
        'Date (Newest First)': '日付（新しい順）',
        'Date (Oldest First)': '日付（古い順）',
        'Score (High to Low)': 'スコア（高い順）',
        'Score (Low to High)': 'スコア（低い順）',
        'Fetching...': '取得中...',
        'NVD API Connected': 'NVD APIに接続済み',
        'API Error': 'APIエラー',
        'Connection Error': '接続エラー',
        'Could not retrieve data from NIST. Please wait a moment and try again.': 'NISTからデータを取得できませんでした。しばらく待ってから再試行してください。',
        'No matching CVEs found.': '該当するCVEは見つかりませんでした。',
        'Published:': '公開:',
        'Updated:': '更新:',
        'PENDING': '評価待ち',
        'Click to expand': 'クリックで全文表示',
    },
    ru: {
        'Late shift.': 'Ночная смена.',
        'Good morning.': 'Доброе утро.',
        'Good afternoon.': 'Добрый день.',
        'Good evening.': 'Добрый вечер.',
        'Quick Search': 'Быстрый поиск',
        'Keyword': 'Ключевое слово',
        'Product, Vendor, or Keyword...': 'Продукт, вендор или ключевое слово...',
        'Timeframe': 'Период',
        'Last 7 Days': 'Последние 7 дней',
        'Last 30 Days': 'Последние 30 дней',
        'Last 90 Days': 'Последние 90 дней',
        'Year 2026': '2026 год',
        'Year 2025': '2025 год',
        'Year 2024': '2024 год',
        'All Time (Slow)': 'За всё время (медленно)',
        'Minimum Severity': 'Минимальная критичность',
        'Any (Includes Unrated)': 'Любая (включая без оценки)',
        'Low+': 'Низкая+',
        'Medium+': 'Средняя+',
        'High+': 'Высокая+',
        'Critical': 'Критическая',
        'Search Database': 'Искать в базе данных',
        '0 Results': '0 результатов',
        'Results Shown': 'результатов показано',
        'Sort By:': 'Сортировка:',
        'Date (Newest First)': 'Дата (сначала новые)',
        'Date (Oldest First)': 'Дата (сначала старые)',
        'Score (High to Low)': 'Оценка (по убыванию)',
        'Score (Low to High)': 'Оценка (по возрастанию)',
        'Fetching...': 'Загрузка...',
        'NVD API Connected': 'API NVD подключен',
        'API Error': 'Ошибка API',
        'Connection Error': 'Ошибка соединения',
        'Could not retrieve data from NIST. Please wait a moment and try again.': 'Не удалось получить данные от NIST. Подождите немного и попробуйте снова.',
        'No matching CVEs found.': 'Подходящих CVE не найдено.',
        'Published:': 'Опубликовано:',
        'Updated:': 'Обновлено:',
        'PENDING': 'ОЖИДАЕТ',
        'Click to expand': 'Нажмите, чтобы развернуть',
    },
};

function currentFleetLang() { return (window.CarinoLang && window.CarinoLang.current) || 'en'; }

function t(key) {
    const dict = I18N[currentFleetLang()];
    return (dict && dict[key]) || key;
}

// Static markup: elements carrying data-i18n use their original English text
// as the key (captured on first pass so locale switches stay reversible).
function applyStaticI18n() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
        if (!el.dataset.i18nKey) el.dataset.i18nKey = el.textContent.trim();
        el.textContent = t(el.dataset.i18nKey);
    });
}

// Prominent attributes, assigned explicitly (not via data-i18n).
function applyAttrI18n() {
    const search = document.getElementById('searchTerm');
    if (search) search.placeholder = t('Product, Vendor, or Keyword...');
}

// #apiStatus is written from the fetch path with t() already applied, so a
// later language switch would strand it in the locale that was active when
// the request ran. It carries no data-i18n (its text only exists at runtime),
// so map the text currently shown back to its English key, then re-translate.
const STATUS_KEYS = ['Fetching...', 'NVD API Connected', 'API Error'];
function applyStatusI18n() {
    const el = document.getElementById('apiStatus');
    if (!el) return;
    const cur = el.textContent.trim();
    if (!cur) return;
    const key = STATUS_KEYS.find((k) => k === cur ||
        Object.keys(I18N).some((l) => I18N[l][k] === cur));
    if (key) el.textContent = t(key);
}

function applyI18n() {
    document.documentElement.lang = currentFleetLang();
    applyStaticI18n();
    applyAttrI18n();
    applyStatusI18n();
}

window.addEventListener('DOMContentLoaded', applyI18n);
window.addEventListener('carino:langchange', () => {
    applyI18n();
    // Re-render already-fetched cards so their JS-built strings switch too.
    if (typeof reSortList === 'function' && Array.isArray(currentVulnerabilities) && currentVulnerabilities.length) {
        reSortList();
    }
});
