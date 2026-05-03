// history.js

const UI = {};
let myChart = null;
let lastLoadedDate = null;
let useHeatmap = true;

const pageSettings = [
{ id: 'fixedValue', key: 'userDelta' },
{ id: 'baselineValue', key: 'userBase' },
{ id: 'monthlyFeeVal', key: 'userMonthlyFee' },
{ id: 'includeFeeToggle', key: 'userIncludeFee', default: false, isCheckbox: true },
{ id: 'heatmapToggle', key: 'userHeatmap', default: true, isCheckbox: true },
{ id: 'workToggle', key: 'histWorkToggle', default: true, isCheckbox: true },
{ id: 'spotToggle', key: 'histSpotToggle', default: true, isCheckbox: true },
{ id: 'usageToggle', key: 'histUsageToggle', default: true, isCheckbox: true }
];

function initDOM() {
['modal', 'modalTitle', 'sumUsage', 'sumCost', 'avgPrice', 'minPrice', 'maxPrice', 'daySavings', 'historyChart']
.forEach(id => UI[id] = document.getElementById(id));
UI.chartCtx = UI.historyChart;
}

function initSettings() {
AppSettings.init(pageSettings);
useHeatmap = document.getElementById('heatmapToggle')?.checked ?? true;
updateVisibility();
}

function handleSettingsChange() {
AppSettings.save(pageSettings);
useHeatmap = document.getElementById('heatmapToggle')?.checked ?? true;
refreshAllStats();
}

function updateVisibility() {
AppSettings.save(pageSettings);
if (myChart) {
myChart.setDatasetVisibility(0, document.getElementById('workToggle').checked);
myChart.setDatasetVisibility(1, document.getElementById('spotToggle').checked);
myChart.setDatasetVisibility(2, document.getElementById('usageToggle').checked);
myChart.update();
}
}

// FIXED: Disabled localStorage for this fetch to prevent quota errors
async function getPriceData(date) {
return ApiManager.fetch(`/api/prices?date=${date}`, `krakendata_${date}`, false);
}

function aggregateData(dataArray) {
let kwh = 0, varCost = 0, pricedKwh = 0, min = Infinity, max = -Infinity;

dataArray.forEach(d => {
const k = parseFloat(d[2]) || 0; // d[2] is usage
const price = getIntervalPrice(d, AppState.delta)

kwh += k;

if (!isNaN(price)) {
varCost += k * price;
pricedKwh += k;
min = Math.min(min, price);
max = Math.max(max, price);
}
});

let cost = varCost;
if (kwh > 0 && AppState.includeFee) {
const sampleDate = dataArray.length > 0 ? dataArray[0][0].split(' ')[0] : null; // d[0] is timestamp
cost += AppState.getProportionalFee('day', sampleDate);
}

const savings = (pricedKwh * AppState.base) - varCost;

return { kwh, cost, varCost, min, max, savings, avg: pricedKwh > 0 ? varCost / pricedKwh : null };
}

function generateStatsHTML(stats, isMultiline = false) {
const savings = stats.savings || 0;
const isPositive = savings >= 0;
const avgStr = stats.avg !== null ? stats.avg.toFixed(4) : '0.0000';
const minStr = stats.min === Infinity ? '0.0000' : stats.min.toFixed(4);
const maxStr = stats.max === -Infinity ? '0.0000' : stats.max.toFixed(4);

const colorClass = isPositive ? "text-primary" : "text-danger";
const marginClass = isMultiline ? "ml-10" : "ml-8";
const detailsClass = isMultiline ? "stats-details-multi" : "stats-details";

return `${stats.kwh.toFixed(1)} kWh | ${stats.cost.toFixed(2)} € <span class="${colorClass} ${marginClass}">(${isPositive ? "Saved" : "Lost"}: ${Math.abs(savings).toFixed(2)} €)</span>${isMultiline ? '<br>' : ' '}<span class="${detailsClass}">(Avg: ${avgStr}€ | Min: ${minStr}€ | Max: ${maxStr}€)</span>`;
}

function applyHeatmap(el, avgFloat, type) {
if (!el || !useHeatmap || avgFloat === null) {
if (el) { el.style.backgroundColor = ''; el.style.borderColor = ''; el.style.borderBottom = ''; el.style.borderLeftColor = ''; }
return;
}

const diff = avgFloat - AppState.base;
const alpha = Math.pow(Math.min(Math.abs(diff) / 0.06, 1.0), 1.3) * (type === 'week' ? 0.85 : (type === 'day' ? 0.6 : 0.45)) + (type === 'week' ? 0.15 : 0);
const color = diff < -0.001 ? '16, 185, 129' : (diff> 0.001 ? '239, 68, 68' : null);

    if (!color) return;

    if (type === 'day' || type === 'month' || type === 'year') {
    el.style.backgroundColor = `rgba(${color}, ${alpha})`;
    const borderProp = type === 'month' ? 'borderBottom' : 'borderColor';
    el.style[borderProp] = `1px solid rgba(${color}, ${alpha + 0.15})`;
    } else if (type === 'week') {
    el.style.borderLeftColor = `rgba(${color}, ${alpha})`;
    }
    }

    function applyExtremesIcons(validDays) {
    validDays.forEach(d => { d.el.style.backgroundImage = ''; d.el.style.boxShadow = ''; });
    if (!useHeatmap || validDays.length === 0) return;

    const maxDay = validDays.reduce((a, b) => a.maxPrice > b.maxPrice ? a : b);
    const minDay = validDays.reduce((a, b) => a.minPrice < b.minPrice ? a : b); const applyIcon=(day, emoji, color)=> {
        if (!day || day.maxPrice === -Infinity || day.minPrice === Infinity) return;
        day.el.style.backgroundImage = `url('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.85em%22 font-size=%2280%22 opacity=%220.9%22>${emoji}</text></svg>')`;
        Object.assign(day.el.style, { backgroundPosition: 'center', backgroundSize: 'contain', backgroundRepeat: 'no-repeat', boxShadow: `inset 0 0 15px rgba(${color}, 0.4)` });
        };

        applyIcon(maxDay, '🔥', '239, 68, 68');
        if (minDay !== maxDay) applyIcon(minDay, '❄️', '59, 130, 246');
        }

        async function loadYearData(yearItem) {
    if (yearItem.dataset.loaded === 'true') return;

    const dayLinks = Array.from(yearItem.querySelectorAll('.day-link'));
    if (!dayLinks.length) return;

    const yearTitle = yearItem.querySelector('.year-title').innerText.trim();
    const cacheKey = `year_data_${yearTitle}`;
    
    // 1. Check Session Storage first (survives tab navigation)
    const sessionCached = sessionStorage.getItem(cacheKey);
    let allYearData;

    if (sessionCached) {
        allYearData = JSON.parse(sessionCached);
    } else {
        const dates = dayLinks.map(el => el.getAttribute('data-date')).sort();
        const startDate = dates[0];
        const endDate = dates[dates.length - 1];

        // 2. Fetch from network if not in session memory
        allYearData = (await ApiManager.fetch(
            `/api/prices?start=${startDate}&end=${endDate}`,
            `year_${startDate}_${endDate}`, false
        )) || [];

        // 3. Save to session storage for instant tab switching
        try {
            sessionStorage.setItem(cacheKey, JSON.stringify(allYearData));
        } catch (e) {
            console.warn("SessionStorage full, continuing in RAM only.");
        }
    }

    const dataByDate = allYearData.reduce((acc, entry) => {
        const date = entry[0].split(' ')[0]; // Tuple index 0
        if (!acc[date]) acc[date] = [];
        acc[date].push(entry);
        return acc;
    }, {});

    for (const item of yearItem.querySelectorAll('.accordion-item')) {
        calculateContainerStats(item, dataByDate);
    }
    calculateYearStats(yearItem, dataByDate);
    
    yearItem.dataset.loaded = 'true';
}

        function toggleAccordionUI(header, contentSelector) {
        const content = header.nextElementSibling;
        const isOpen = content.classList.contains('active');
        document.querySelectorAll(contentSelector).forEach(c => c.classList.remove('active'));
        if (!isOpen) content.classList.add('active');
        }

        async function toggleYearAccordion(header) {
        const yearItem = header.closest('.year-accordion-item');
        if (yearItem.dataset.loaded !== 'true') {
        const statsLabel = header.querySelector('.year-stats-label');
        if (statsLabel) statsLabel.innerHTML = '<span class="stats-details-multi">⏳ Loading data...</span>';
        await loadYearData(yearItem);
        }
        toggleAccordionUI(header, '.year-accordion-content');
        }

        function toggleAccordion(header) { toggleAccordionUI(header, '.accordion-content'); }

        function calculateContainerStats(item, dataByDate) {
        const dayLinks = Array.from(item.querySelectorAll('.day-link'));
        if (!dayLinks.length) return;

        const weekSections = item.querySelectorAll('.week-section');
        let mStats = { kwh: 0, cost: 0, varCost: 0, savings: 0, min: Infinity, max: -Infinity };
        let validMonthDays = [];

        for (const section of weekSections) {
        const sectionLinks = Array.from(section.querySelectorAll('.day-link'));
        let wStats = { kwh: 0, cost: 0, varCost: 0, savings: 0, min: Infinity, max: -Infinity };

        sectionLinks.forEach((dayEl) => {
        const date = dayEl.getAttribute('data-date');
        const dData = dataByDate[date] || [];
        const dStats = aggregateData(dData);

        // FIXED: Only save to RAM (memoryCache), never to localStorage.
        const cacheKey = `krakendata_${date}`;
        ApiManager.memoryCache.set(cacheKey, dData);

        Object.assign(dayEl.dataset, {
        usage: dStats.kwh.toFixed(2) + ' kWh',
        cost: dStats.cost.toFixed(2) + ' €',
        avg: dStats.avg !== null ? dStats.avg.toFixed(4) + ' €' : '0.0000 €',
        min: dStats.min === Infinity ? '0.0000 €' : dStats.min.toFixed(4) + ' €',
        max: dStats.max === -Infinity ? '0.0000 €' : dStats.max.toFixed(4) + ' €',
        savings: dStats.savings.toFixed(2),
        loaded: 'true'
        });

        applyHeatmap(dayEl, dStats.avg, 'day');
        if (dStats.avg !== null && dStats.kwh > 0) validMonthDays.push({ el: dayEl, maxPrice: dStats.max, minPrice: dStats.min });

        wStats.kwh += dStats.kwh; wStats.cost += dStats.cost; wStats.varCost += dStats.varCost; wStats.savings += dStats.savings;
        wStats.min = Math.min(wStats.min, dStats.min); wStats.max = Math.max(wStats.max, dStats.max);
        });

        wStats.avg = wStats.kwh > 0 ? (wStats.varCost / (wStats.savings + wStats.varCost) * AppState.base) : null;
        section.querySelector('.week-stats-label').innerHTML = generateStatsHTML(wStats, false);
        applyHeatmap(section, wStats.avg, 'week');

        mStats.kwh += wStats.kwh; mStats.cost += wStats.cost; mStats.varCost += wStats.varCost; mStats.savings += wStats.savings;
        mStats.min = Math.min(mStats.min, wStats.min); mStats.max = Math.max(mStats.max, wStats.max);
        }

        applyExtremesIcons(validMonthDays);
        mStats.avg = mStats.kwh > 0 ? (mStats.varCost / (mStats.savings + mStats.varCost) * AppState.base) : null;
        item.querySelector('.month-stats-label').innerHTML = generateStatsHTML(mStats, true);
        applyHeatmap(item.querySelector('.accordion-header'), mStats.avg, 'month');
        }

        function calculateYearStats(yearItem, dataByDate) {
        const days = Array.from(yearItem.querySelectorAll('.day-link')).map(el => el.getAttribute('data-date'));
        if (!days.length) return;

        const yStats = days.reduce((acc, date) => {
        const data = dataByDate[date] || [];
        const d = aggregateData(data);
        return {
        kwh: acc.kwh + d.kwh, cost: acc.cost + d.cost, varCost: acc.varCost + d.varCost, savings: acc.savings + d.savings,
        min: Math.min(acc.min, d.min), max: Math.max(acc.max, d.max)
        };
        }, { kwh: 0, cost: 0, varCost: 0, savings: 0, min: Infinity, max: -Infinity });

        yStats.avg = yStats.kwh > 0 ? (yStats.varCost / (yStats.savings + yStats.varCost) * AppState.base) : null;
        const labelEl = yearItem.querySelector('.year-stats-label');
        if (labelEl) labelEl.innerHTML = generateStatsHTML(yStats, true);
        applyHeatmap(yearItem.querySelector('.year-accordion-header'), yStats.avg, 'year');
        }

        function refreshAllStats() {
        if (lastLoadedDate && UI.modal.style.display === 'flex') showGraph(lastLoadedDate, true);
        document.querySelectorAll('.year-accordion-item').forEach(yearItem => {
        if (yearItem.dataset.loaded === 'true') {
        yearItem.dataset.loaded = 'false';
        loadYearData(yearItem).then();
        }
        });
        }

        async function showGraph(date, isSilentUpdate = false) {
        lastLoadedDate = date;
        if (!isSilentUpdate) {
        UI.modal.style.display = 'flex';
        UI.modalTitle.innerText = "Analysis for " + date;
        }

        try {
        const data = await getPriceData(date);
        const stats = aggregateData(data);
        const dailySavings = stats.savings || 0;

        UI.sumUsage.innerText = stats.kwh.toFixed(2) + " kWh";
        UI.sumCost.innerText = stats.cost.toFixed(2) + " €";
        UI.avgPrice.innerText = stats.avg !== null ? stats.avg.toFixed(4) + " €" : "0.0000 €";
        UI.minPrice.innerText = stats.min === Infinity ? "0.0000 €" : stats.min.toFixed(4) + " €";
        UI.maxPrice.innerText = stats.max === -Infinity ? "0.0000 €" : stats.max.toFixed(4) + " €";

        if (UI.daySavings) {
        UI.daySavings.innerText = `${dailySavings >= 0 ? "Saved" : "Lost"}: ${Math.abs(dailySavings).toFixed(2)} €`;
        UI.daySavings.className = `summary-item-value ${dailySavings >= 0 ? "text-primary" : "text-danger"}`;
        }

            const datasets = data.reduce((acc, d) => {
            acc.labels.push(d[0].split(' ')[1]); // d[0] is timestamp
            const p = getIntervalPrice(d, AppState.delta);
            acc.work.push(isNaN(p) ? null : p.toFixed(4));
            acc.spot.push(d[1] !== null ? (parseFloat(d[1]) * TAXES).toFixed(4) : null); // d[1] is spot
            acc.usage.push(parseFloat(d[2]) || 0); // d[2] is usage
            acc.base.push(AppState.base);
            return acc;
             }, { labels: [], work: [], spot: [], usage: [], base: [] });

        if (myChart) myChart.destroy();
        myChart = new Chart(UI.chartCtx, {
        data: {
        labels: datasets.labels,
        datasets: [
        { type: 'line', label: 'Work Price', data: datasets.work, borderColor: '#007bff', backgroundColor: 'rgba(0,123,255,0.05)', fill: true, tension: 0.3, pointRadius: 0, yAxisID: 'y', hidden: !document.getElementById('workToggle').checked, spanGaps: true },
        { type: 'line', label: 'Spot Price', data: datasets.spot, borderColor: '#28a745', tension: 0.3, pointRadius: 0, yAxisID: 'y', hidden: !document.getElementById('spotToggle').checked, spanGaps: true },
        { type: 'bar', label: 'kWh', data: datasets.usage, backgroundColor: 'rgba(255, 215, 0, 0.3)', yAxisID: 'yUsage', hidden: !document.getElementById('usageToggle').checked },
        { type: 'line', label: 'Baseline', data: datasets.base, borderColor: '#fa5252', borderDash: [5, 5], pointRadius: 0, yAxisID: 'y' }
        ]
        },
        options: {
        responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
        scales: { y: { position: 'left', grid: { color: '#333' } }, yUsage: { position: 'right', grid: { drawOnChartArea: false } } },
        plugins: {
        tooltip: {
        filter: item => item.dataset.label !== 'Baseline',
        callbacks: {
        label: ctx => {
        let label = ctx.dataset.label ? `${ctx.dataset.label}: ` : '';
        if (ctx.parsed.y !== null && !isNaN(ctx.parsed.y)) {
        if (label.includes('Price')) return label + ctx.parsed.y.toFixed(4) + ' €';
        if (label.includes('kWh')) {
        const p = getIntervalPrice(data[ctx.dataIndex], AppState.delta);
        const blockCostStr = isNaN(p) ? "No Price Data" : `${(ctx.parsed.y * p).toFixed(4)} €`;
        return `${label}${ctx.parsed.y.toFixed(2)} kWh (Block Cost: ${blockCostStr})`;
        }
        return label + ctx.parsed.y;
        }
        }
        }
        }
        }
        }
        });
        } catch (err) { console.error(err); }
        }

        function closeModal() { UI.modal.style.display = 'none'; }
        window.onclick = e => { if (e.target == UI.modal) closeModal(); };

        async function syncHistory(event) {
        const btn = document.querySelector('.btn-action');
        const targetDate = document.getElementById('syncFromDate').value;
        const daysToSync = dayjs().startOf('day').diff(dayjs(targetDate).startOf('day'), 'day');

        const result = await runDataSync(btn, daysToSync, event?.shiftKey);
        if (result.success && (result.hasChanges || event?.shiftKey)) {
        ApiManager.clearCache();
        refreshAllStats();
        }
        setTimeout(() => { btn.innerText = "🔄 Sync Archive"; btn.disabled = false; }, 3000);
        }

        if (window.matchMedia && window.matchMedia('(hover: hover)').matches) {
        const tooltip = document.getElementById('hoverTooltip');
        const ttEls = {
        usage: document.getElementById('ttUsage'),
        cost: document.getElementById('ttCost'),
        avg: document.getElementById('ttAvg'),
        min: document.getElementById('ttMin'),
        max: document.getElementById('ttMax'),
        savings: document.getElementById('ttSavings')
        };

        document.addEventListener('mouseover', e => {
        const dayEl = e.target.closest('.day-link');
        if (!dayEl) return;

        ['usage', 'cost', 'avg', 'min', 'max'].forEach(k => {
        ttEls[k].innerText = dayEl.dataset.loaded === 'true' ? dayEl.dataset[k] : '...';
        });

        if (ttEls.savings && dayEl.dataset.loaded === 'true') {
        const val = parseFloat(dayEl.dataset.savings || 0);
        ttEls.savings.innerText = val >= 0 ? `Saved: ${val.toFixed(2)} €` : `Lost: ${Math.abs(val).toFixed(2)} €`;
        ttEls.savings.className = `tt-val ${val >= 0 ? "text-primary" : "text-danger"}`;
        }

        const rect = dayEl.getBoundingClientRect();
        tooltip.style.left = `${rect.left + (rect.width / 2) + window.scrollX}px`;
        tooltip.style.top = `${rect.top + window.scrollY}px`;
        tooltip.classList.add('visible');
        });

        document.addEventListener('mouseout', e => {
        if (e.target.closest('.day-link')) tooltip.classList.remove('visible');
        });
        }

        window.onload = () => {
initDOM();
initSettings();

// 1. Synchronize Session & Local Storage
// If a new sync happened on the dashboard, we wipe the session to prevent stale data.
const currentSync = localStorage.getItem('lastSync') || '0';
if (sessionStorage.getItem('lastSyncVersion') !== currentSync) {
sessionStorage.clear();
sessionStorage.setItem('lastSyncVersion', currentSync);
}

// 2. Handle UI State (Settings Menu)
if (sessionStorage.getItem('keepSettingsMenuOpen') === 'true') {
document.getElementById('settingsMenu').classList.add('active');
sessionStorage.removeItem('keepSettingsMenuOpen');
}

// 3. Initialize Sync Date Constraints
const syncDateInput = document.getElementById('syncFromDate');
syncDateInput.max = dayjs().format('YYYY-MM-DD');
syncDateInput.min = dayjs().subtract(1, 'year').format('YYYY-MM-DD');
syncDateInput.value = syncDateInput.max;

// 4. Smart Data Bootloader
setTimeout(async () => {
const currentYearStr = dayjs().format('YYYY');

for (const year of document.querySelectorAll('.year-accordion-item')) {
const yearTitle = year.querySelector('.year-title').innerText.trim();
const cacheKey = `year_data_${yearTitle}`;

/**
* THE SMART CHECK:
* - Always auto-load the current year (it might have new today-data).
* - Auto-load any other year IF it's already in the session cache.
*/
const dataInSession = sessionStorage.getItem(cacheKey);

if (yearTitle === currentYearStr || dataInSession) {
// Populate the internal RAM cache and render the labels/heatmaps
await loadYearData(year);

// Only auto-expand the actual drawer for the current year
if (yearTitle === currentYearStr) {
year.querySelector('.year-accordion-header').nextElementSibling.classList.add('active');
}
} else {
// Only show the prompt for years that are truly "cold" (no data in RAM or Session)
const label = year.querySelector('.year-stats-label');
if (label) {
label.innerHTML = '<span class="stats-details-multi">👆 Click to load data</span>';
}
}
}
}, 50);
};