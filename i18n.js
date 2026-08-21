// i18n — CVE Radar Pro. Fleet convention (see Topo/js/i18n.js): English source
// strings ARE the keys, so a missing entry falls back to English. Locale comes
// from carino-lang.js (window.CarinoLang.current); this script is deferred and
// placed after it, so CarinoLang exists by DOMContentLoaded. Reacts to the
// fleet 'carino:langchange' event. Quick-search tags (product names), CVE data
// and the "CVE Radar Pro" app name stay English on purpose; the API status
// line is translated and re-mapped on switch (see applyStatusI18n).
//
// Strings containing %1/%2/%3 are filled by tf() in index.html. Keep the
// placeholders, and keep them in an order that reads naturally in the locale.

const I18N = {
    es: {
        'Late shift.': 'Turno nocturno.',
        'Good morning.': 'Buenos días.',
        'Good afternoon.': 'Buenas tardes.',
        'Good evening.': 'Buenas noches.',
        // Sidebar filters
        // Quick views
        'Quick Views': 'Vistas rápidas',
        'Quick views': 'Vistas rápidas',
        'A view is a keyword plus a timeframe, a severity floor and a sort order — the same thing the share link carries. Star up to five to keep them in the sidebar.': 'Una vista es una palabra clave más un período, un mínimo de gravedad y un orden — lo mismo que lleva el enlace para compartir. Marca hasta cinco para dejarlas en la barra lateral.',
        'Save current view': 'Guardar vista actual',
        'Name this view': 'Nombra esta vista',
        'Filter views…': 'Filtrar vistas…',
        'Export': 'Exportar',
        'Import': 'Importar',
        'Saved views live in this browser only.': 'Las vistas guardadas solo viven en este navegador.',
        'All quick views': 'Todas las vistas rápidas',
        'No views match.': 'Ninguna vista coincide.',
        'Untitled view': 'Vista sin título',
        'Any severity': 'Cualquier gravedad',
        'Pin': 'Fijar',
        'Unpin': 'Quitar',
        'Delete': 'Eliminar',
        'Yours': 'Tuyas',
        'Triage': 'Triaje',
        'Edge & VPN': 'Perímetro y VPN',
        'Operating systems': 'Sistemas operativos',
        'Servers & data': 'Servidores y datos',
        'Browsers': 'Navegadores',
        'Clinical & imaging': 'Clínico e imagenología',
        'Cloud & CI': 'Nube y CI',
        'Languages & runtimes': 'Lenguajes y entornos',
        'Critical · last 7 days': 'Crítica · últimos 7 días',
        'High+ · last 30 days': 'Alta+ · últimos 30 días',
        'Keyword': 'Palabra clave',
        'Product, Vendor, or Keyword...': 'Producto, fabricante o palabra clave...',
        'Timeframe': 'Período',
        'Last 7 Days': 'Últimos 7 días',
        'Last 30 Days': 'Últimos 30 días',
        'Last 90 Days': 'Últimos 90 días',
        'Year %1': 'Año %1',
        'Minimum Severity': 'Gravedad mínima',
        'Any (Includes Unrated)': 'Cualquiera (incluye sin puntuar)',
        'Low+': 'Baja+',
        'Medium+': 'Media+',
        'High+': 'Alta+',
        'Critical only': 'Solo crítica',
        'A floor, not an exact match: High+ includes Critical.': 'Es un mínimo, no una coincidencia exacta: Alta+ incluye Crítica.',
        'Search Database': 'Buscar en la base de datos',
        'Data: NVD — retrieved %1': 'Datos: NVD — obtenidos el %1',
        // Results header
        'Showing %1 of %2 loaded (%3 matched)': 'Mostrando %1 de %2 cargados (%3 coincidencias)',
        'Sort By:': 'Ordenar por:',
        'Date (Newest First)': 'Fecha (más recientes primero)',
        'Date (Oldest First)': 'Fecha (más antiguas primero)',
        'Score (High to Low)': 'Puntuación (de mayor a menor)',
        'Score (Low to High)': 'Puntuación (de menor a mayor)',
        'Load more (%1 not yet loaded)': 'Cargar más (%1 sin cargar)',
        // Status line + errors
        'Fetching...': 'Consultando...',
        'Loading %1 of %2 requests…': 'Cargando consulta %1 de %2…',
        'Rate limit reached — waiting %1s': 'Límite de peticiones alcanzado: esperando %1 s',
        'NVD API Connected': 'API de NVD conectada',
        'API Error': 'Error de API',
        'Connection Error': 'Error de conexión',
        'Could not retrieve data from NIST. Please wait a moment and try again.': 'No se pudieron obtener datos del NIST. Espera un momento y vuelve a intentarlo.',
        'NVD is rate-limiting this browser. Wait about a minute and try again.': 'NVD está limitando las peticiones de este navegador. Espera un minuto y vuelve a intentarlo.',
        'No CVEs were published in this window.': 'No se publicaron CVE en este período.',
        'All %1 loaded records were filtered out by the severity floor.': 'El filtro de gravedad descartó los %1 registros cargados.',
        // CVE cards
        'Published:': 'Publicado:',
        'Updated:': 'Actualizado:',
        'PENDING': 'PENDIENTE',
        'Expand description': 'Ampliar descripción',
        'Collapse description': 'Contraer descripción',
        'Copy ID': 'Copiar ID',
        'Copied': 'Copiado',
    },
    'pt-BR': {
        'Late shift.': 'Turno da noite.',
        'Good morning.': 'Bom dia.',
        'Good afternoon.': 'Boa tarde.',
        'Good evening.': 'Boa noite.',
        // Quick views
        'Quick Views': 'Visões rápidas',
        'Quick views': 'Visões rápidas',
        'A view is a keyword plus a timeframe, a severity floor and a sort order — the same thing the share link carries. Star up to five to keep them in the sidebar.': 'Uma visão é uma palavra-chave mais um período, um mínimo de gravidade e uma ordenação — o mesmo que o link de compartilhamento carrega. Marque até cinco para mantê-las na barra lateral.',
        'Save current view': 'Salvar visão atual',
        'Name this view': 'Nomeie esta visão',
        'Filter views…': 'Filtrar visões…',
        'Export': 'Exportar',
        'Import': 'Importar',
        'Saved views live in this browser only.': 'As visões salvas ficam apenas neste navegador.',
        'All quick views': 'Todas as visões rápidas',
        'No views match.': 'Nenhuma visão corresponde.',
        'Untitled view': 'Visão sem título',
        'Any severity': 'Qualquer gravidade',
        'Pin': 'Fixar',
        'Unpin': 'Desafixar',
        'Delete': 'Excluir',
        'Yours': 'Suas',
        'Triage': 'Triagem',
        'Edge & VPN': 'Perímetro e VPN',
        'Operating systems': 'Sistemas operacionais',
        'Servers & data': 'Servidores e dados',
        'Browsers': 'Navegadores',
        'Clinical & imaging': 'Clínico e imagem',
        'Cloud & CI': 'Nuvem e CI',
        'Languages & runtimes': 'Linguagens e runtimes',
        'Critical · last 7 days': 'Crítica · últimos 7 dias',
        'High+ · last 30 days': 'Alta+ · últimos 30 dias',
        'Keyword': 'Palavra-chave',
        'Product, Vendor, or Keyword...': 'Produto, fornecedor ou palavra-chave...',
        'Timeframe': 'Período',
        'Last 7 Days': 'Últimos 7 dias',
        'Last 30 Days': 'Últimos 30 dias',
        'Last 90 Days': 'Últimos 90 dias',
        'Year %1': 'Ano %1',
        'Minimum Severity': 'Gravidade mínima',
        'Any (Includes Unrated)': 'Qualquer (inclui sem nota)',
        'Low+': 'Baixa+',
        'Medium+': 'Média+',
        'High+': 'Alta+',
        'Critical only': 'Somente crítica',
        'A floor, not an exact match: High+ includes Critical.': 'É um mínimo, não uma correspondência exata: Alta+ inclui Crítica.',
        'Search Database': 'Pesquisar no banco de dados',
        'Data: NVD — retrieved %1': 'Dados: NVD — obtidos em %1',
        'Showing %1 of %2 loaded (%3 matched)': 'Exibindo %1 de %2 carregados (%3 correspondências)',
        'Sort By:': 'Ordenar por:',
        'Date (Newest First)': 'Data (mais recentes primeiro)',
        'Date (Oldest First)': 'Data (mais antigas primeiro)',
        'Score (High to Low)': 'Pontuação (da maior para a menor)',
        'Score (Low to High)': 'Pontuação (da menor para a maior)',
        'Load more (%1 not yet loaded)': 'Carregar mais (%1 não carregados)',
        'Fetching...': 'Consultando...',
        'Loading %1 of %2 requests…': 'Carregando consulta %1 de %2…',
        'Rate limit reached — waiting %1s': 'Limite de requisições atingido — aguardando %1 s',
        'NVD API Connected': 'API do NVD conectada',
        'API Error': 'Erro de API',
        'Connection Error': 'Erro de conexão',
        'Could not retrieve data from NIST. Please wait a moment and try again.': 'Não foi possível obter dados do NIST. Aguarde um momento e tente novamente.',
        'NVD is rate-limiting this browser. Wait about a minute and try again.': 'O NVD está limitando as requisições deste navegador. Aguarde um minuto e tente novamente.',
        'No CVEs were published in this window.': 'Nenhum CVE foi publicado neste período.',
        'All %1 loaded records were filtered out by the severity floor.': 'O filtro de gravidade descartou os %1 registros carregados.',
        'Published:': 'Publicado:',
        'Updated:': 'Atualizado:',
        'PENDING': 'PENDENTE',
        'Expand description': 'Expandir descrição',
        'Collapse description': 'Recolher descrição',
        'Copy ID': 'Copiar ID',
        'Copied': 'Copiado',
    },
    ja: {
        'Late shift.': '夜勤お疲れさま。',
        'Good morning.': 'おはようございます。',
        'Good afternoon.': 'こんにちは。',
        'Good evening.': 'こんばんは。',
        // Quick views
        'Quick Views': 'クイックビュー',
        'Quick views': 'クイックビュー',
        'A view is a keyword plus a timeframe, a severity floor and a sort order — the same thing the share link carries. Star up to five to keep them in the sidebar.': 'ビューとは、キーワード・期間・深刻度の下限・並び順のことです（共有リンクと同じ内容）。★を付けると最大5件までサイドバーに固定できます。',
        'Save current view': '現在のビューを保存',
        'Name this view': 'ビュー名',
        'Filter views…': 'ビューを絞り込み…',
        'Export': 'エクスポート',
        'Import': 'インポート',
        'Saved views live in this browser only.': '保存したビューはこのブラウザ内にのみ保存されます。',
        'All quick views': 'すべてのクイックビュー',
        'No views match.': '該当するビューはありません。',
        'Untitled view': '無題のビュー',
        'Any severity': 'すべての深刻度',
        'Pin': '固定',
        'Unpin': '固定を解除',
        'Delete': '削除',
        'Yours': 'マイビュー',
        'Triage': 'トリアージ',
        'Edge & VPN': '境界機器・VPN',
        'Operating systems': 'OS',
        'Servers & data': 'サーバー・データ',
        'Browsers': 'ブラウザ',
        'Clinical & imaging': '医療・画像',
        'Cloud & CI': 'クラウド・CI',
        'Languages & runtimes': '言語・ランタイム',
        'Critical · last 7 days': '緊急 · 過去7日間',
        'High+ · last 30 days': '高以上 · 過去30日間',
        'Keyword': 'キーワード',
        'Product, Vendor, or Keyword...': '製品名・ベンダー名・キーワード...',
        'Timeframe': '期間',
        'Last 7 Days': '過去7日間',
        'Last 30 Days': '過去30日間',
        'Last 90 Days': '過去90日間',
        'Year %1': '%1年',
        'Minimum Severity': '最低深刻度',
        'Any (Includes Unrated)': 'すべて（未評価を含む）',
        'Low+': '低以上',
        'Medium+': '中以上',
        'High+': '高以上',
        'Critical only': '緊急のみ',
        'A floor, not an exact match: High+ includes Critical.': '完全一致ではなく下限です。「高以上」には緊急も含まれます。',
        'Search Database': 'データベースを検索',
        'Data: NVD — retrieved %1': 'データ: NVD — 取得日時 %1',
        'Showing %1 of %2 loaded (%3 matched)': '取得%2件中%1件を表示（該当%3件）',
        'Sort By:': '並び替え:',
        'Date (Newest First)': '日付（新しい順）',
        'Date (Oldest First)': '日付（古い順）',
        'Score (High to Low)': 'スコア（高い順）',
        'Score (Low to High)': 'スコア（低い順）',
        'Load more (%1 not yet loaded)': 'さらに読み込む（未取得%1件）',
        'Fetching...': '取得中...',
        'Loading %1 of %2 requests…': 'リクエスト%2件中%1件を取得中…',
        'Rate limit reached — waiting %1s': 'レート制限に達しました — %1秒待機中',
        'NVD API Connected': 'NVD APIに接続済み',
        'API Error': 'APIエラー',
        'Connection Error': '接続エラー',
        'Could not retrieve data from NIST. Please wait a moment and try again.': 'NISTからデータを取得できませんでした。しばらく待ってから再試行してください。',
        'NVD is rate-limiting this browser. Wait about a minute and try again.': 'NVDがこのブラウザのリクエストを制限しています。1分ほど待ってから再試行してください。',
        'No CVEs were published in this window.': 'この期間に公開されたCVEはありません。',
        'All %1 loaded records were filtered out by the severity floor.': '取得した%1件はすべて深刻度の下限で除外されました。',
        'Published:': '公開:',
        'Updated:': '更新:',
        'PENDING': '評価待ち',
        'Expand description': '説明を全文表示',
        'Collapse description': '説明を折りたたむ',
        'Copy ID': 'IDをコピー',
        'Copied': 'コピーしました',
    },
    ru: {
        'Late shift.': 'Ночная смена.',
        'Good morning.': 'Доброе утро.',
        'Good afternoon.': 'Добрый день.',
        'Good evening.': 'Добрый вечер.',
        // Quick views
        'Quick Views': 'Быстрые представления',
        'Quick views': 'Быстрые представления',
        'A view is a keyword plus a timeframe, a severity floor and a sort order — the same thing the share link carries. Star up to five to keep them in the sidebar.': 'Представление — это ключевое слово, период, порог критичности и порядок сортировки, то же самое, что несёт ссылка. Отметьте звёздочкой до пяти, чтобы закрепить их в боковой панели.',
        'Save current view': 'Сохранить текущее',
        'Name this view': 'Название представления',
        'Filter views…': 'Фильтр представлений…',
        'Export': 'Экспорт',
        'Import': 'Импорт',
        'Saved views live in this browser only.': 'Сохранённые представления хранятся только в этом браузере.',
        'All quick views': 'Все быстрые представления',
        'No views match.': 'Ничего не найдено.',
        'Untitled view': 'Без названия',
        'Any severity': 'Любая критичность',
        'Pin': 'Закрепить',
        'Unpin': 'Открепить',
        'Delete': 'Удалить',
        'Yours': 'Ваши',
        'Triage': 'Триаж',
        'Edge & VPN': 'Периметр и VPN',
        'Operating systems': 'Операционные системы',
        'Servers & data': 'Серверы и данные',
        'Browsers': 'Браузеры',
        'Clinical & imaging': 'Медицина и визуализация',
        'Cloud & CI': 'Облако и CI',
        'Languages & runtimes': 'Языки и среды',
        'Critical · last 7 days': 'Критическая · последние 7 дней',
        'High+ · last 30 days': 'Высокая+ · последние 30 дней',
        'Keyword': 'Ключевое слово',
        'Product, Vendor, or Keyword...': 'Продукт, производитель или ключевое слово...',
        'Timeframe': 'Период',
        'Last 7 Days': 'Последние 7 дней',
        'Last 30 Days': 'Последние 30 дней',
        'Last 90 Days': 'Последние 90 дней',
        'Year %1': '%1 год',
        'Minimum Severity': 'Минимальная критичность',
        'Any (Includes Unrated)': 'Любая (включая без оценки)',
        'Low+': 'Низкая+',
        'Medium+': 'Средняя+',
        'High+': 'Высокая+',
        'Critical only': 'Только критическая',
        'A floor, not an exact match: High+ includes Critical.': 'Это нижняя граница, а не точное совпадение: «Высокая+» включает критические.',
        'Search Database': 'Искать в базе данных',
        'Data: NVD — retrieved %1': 'Данные: NVD — получены %1',
        'Showing %1 of %2 loaded (%3 matched)': 'Показано %1 из %2 загруженных (найдено %3)',
        'Sort By:': 'Сортировка:',
        'Date (Newest First)': 'Дата (сначала новые)',
        'Date (Oldest First)': 'Дата (сначала старые)',
        'Score (High to Low)': 'Оценка (по убыванию)',
        'Score (Low to High)': 'Оценка (по возрастанию)',
        'Load more (%1 not yet loaded)': 'Загрузить ещё (не загружено: %1)',
        'Fetching...': 'Загрузка...',
        'Loading %1 of %2 requests…': 'Запрос %1 из %2…',
        'Rate limit reached — waiting %1s': 'Достигнут лимит запросов — ожидание %1 с',
        'NVD API Connected': 'API NVD подключен',
        'API Error': 'Ошибка API',
        'Connection Error': 'Ошибка соединения',
        'Could not retrieve data from NIST. Please wait a moment and try again.': 'Не удалось получить данные от NIST. Подождите немного и попробуйте снова.',
        'NVD is rate-limiting this browser. Wait about a minute and try again.': 'NVD ограничивает запросы этого браузера. Подождите около минуты и попробуйте снова.',
        'No CVEs were published in this window.': 'В этом периоде не опубликовано ни одного CVE.',
        'All %1 loaded records were filtered out by the severity floor.': 'Все загруженные записи (%1) отсеяны порогом критичности.',
        'Published:': 'Опубликовано:',
        'Updated:': 'Обновлено:',
        'PENDING': 'ОЖИДАЕТ',
        'Expand description': 'Развернуть описание',
        'Collapse description': 'Свернуть описание',
        'Copy ID': 'Копировать ID',
        'Copied': 'Скопировано',
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
// Only the three stable states are mapped; the progress lines are transient
// and carry interpolated numbers, so they are left to the next render.
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
    // Rebuild the year options and re-render the cards so the strings the
    // client builds in JS switch too (see window.cveRerender in index.html).
    if (typeof window.cveRerender === 'function') window.cveRerender();
});
