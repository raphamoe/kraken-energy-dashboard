// statistics.js

let currentMode = 'week',
	customDates = {
		start: '',
		end: ''
	};
const UI = {};
const pageSettings = [{
	id: 'deltaVal',
	key: 'userDelta'
}, {
	id: 'baseVal',
	key: 'userBase'
}, {
	id: 'monthlyFeeVal',
	key: 'userMonthlyFee'
}];

function initDOM() {
	['customPanel', 'customStart', 'customEnd', 'statAvg', 'statTotalWithFee', 'statMarketAvg', 'statUsage', 'statDailyAvg', 'statMax', 'statMin', 'statCost', 'statSavings'].forEach(id => UI[id] = document.getElementById(id));
}

function initSettings() {
	AppSettings.init(pageSettings);
}

function handleSettingsChange() {
	AppSettings.save(pageSettings);
	if (currentMode !== 'custom' || (customDates.start && customDates.end)) loadStats(currentMode);
}

function getDatesForMode(mode) {
	let start = dayjs(),
		end = dayjs();

	if (mode === 'all') {
        start = dayjs(OLDEST_DATE);
    } else if (mode === 'week') {
        // Fix: Account for Day.js treating Sunday (0) as the start of the week
        let dayOfWeek = dayjs().day(); 
        if (dayOfWeek === 0) {
            // If today is Sunday, Monday was 6 days ago
            start = dayjs().subtract(6, 'day');
        } else {
            // Otherwise, grab this week's Sunday and add 1 day to get Monday
            start = dayjs().startOf('week').add(1, 'day');
        }
    } else if (mode === 'month') {
        start = dayjs().startOf('month');
    } else if (mode === '3months') {
        start = dayjs().subtract(2, 'month').startOf('month');
    } else if (mode === 'year') {
        start = dayjs().startOf('year');
    } else if (mode === 'custom') {
		if (!customDates.start || !customDates.end) return null;
		return {
			start: customDates.start,
			end: customDates.end
		};
	}

	return {
		start: start.format('YYYY-MM-DD'),
		end: end.format('YYYY-MM-DD')
	};
}

function toggleCustomPanel(btn) {
	document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
	if (btn) btn.classList.add('active');
	UI.customPanel.style.display = 'flex';
	currentMode = 'custom';
	if (customDates.start && customDates.end) loadStats('custom');
}

function applyCustomDate() {
	if (!UI.customStart.value || !UI.customEnd.value) return alert("Please select both dates.");
	if (dayjs(UI.customStart.value).isAfter(dayjs(UI.customEnd.value))) return alert("Start cannot be after end.");
	customDates = {
		start: UI.customStart.value,
		end: UI.customEnd.value
	};
	loadStats('custom', document.getElementById('btn-custom'));
}

async function loadStats(mode, btn = document.querySelector('.filter-btn.active')) {
	if (mode !== 'custom') UI.customPanel.style.display = 'none';
	currentMode = mode;

	if (btn) {
		document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
		btn.classList.add('active');
	}

	const dates = getDatesForMode(mode);
	if (!dates) return;

	try {
		const url = `/api/stats?start=${dates.start}&end=${dates.end}&delta=${AppState.delta}&baseline=${AppState.base}&monthly_fee=${AppState.fee}`;
		const data = await ApiManager.fetch(url, `${url}_v${localStorage.getItem('lastSync') || '0'}`, true);

		const fill = (id, key, fallback = 0, fixed = 2, suffix = '') => UI[id].innerText = `${(data[key] ?? fallback).toFixed(fixed)} ${suffix}`;

		fill('statAvg', 'avg_price', 0, 4, '€');
		fill('statTotalWithFee', 'total_cost_with_fee', 0, 2, '€');
		fill('statMarketAvg', 'market_avg', 0, 4, '€');
		fill('statUsage', 'total_kwh', 0, 2, 'kWh');
		fill('statDailyAvg', 'daily_avg', 0, 2, 'kWh');
		fill('statMax', 'max_price', 0, 4, '€');
		fill('statMin', 'min_price', 0, 4, '€');
		fill('statCost', 'total_cost', 0, 2, '€');

		UI.statSavings.innerText = `${(data.savings || 0).toFixed(2)} €`;
		UI.statSavings.className = `stat-value ${(data.savings || 0) >= 0 ? "text-primary" : "text-danger"}`;
	} catch (err) {
		console.error("Stats error:", err);
	}
}

window.onload = () => {
	initDOM();
	initSettings();
	loadStats('week', document.getElementById('btn-week'));
};