// consumption.js

const UI = {};
let myChart = null,
	currentMode = 'day',
	baseDate = dayjs(LATEST_DATE),
	isEuro = false,
	isTable = false,
	currentData = [];

const pageSettings = [{
		id: 'fixedValue',
		key: 'userDelta'
	},
	{
		id: 'monthlyFeeVal',
		key: 'userMonthlyFee'
	},
	{
		id: 'includeFeeToggle',
		key: 'userIncludeFee',
		default: false,
		isCheckbox: true
	}
];

function initDOM() {
	['chartContainer', 'tableContainer', 'customDatePanel', 'customStart', 'customEnd', 'dateRangeDisplay', 'totalValue', 'tableBody', 'noDataOverlay', 'labelKwh', 'labelEur', 'totalUnit'].forEach(id => UI[id] = document.getElementById(id));
	UI.chartCtx = document.getElementById('consumptionChart').getContext('2d');
}

function initSettings() {
	AppSettings.init(pageSettings);
}

function handleSettingsChange(e) {
	const changedId = e?.target?.id;
	AppSettings.save(pageSettings);

	if (changedId === 'fixedValue' || changedId === 'includeFeeToggle' || changedId === 'monthlyFeeVal') {
		renderData();
	} else {
		fetchData();
	}
}

function debounce(func, wait) {
	let timeout;
	return function(...args) {
		clearTimeout(timeout);
		timeout = setTimeout(() => func.apply(this, args), wait);
	};
}
const debouncedSettingsChange = debounce(handleSettingsChange, 150);

function toggleUnit() {
	isEuro = document.getElementById('unitToggle').checked;
	UI.labelKwh.className = isEuro ? 'inactive-text' : 'active-text';
	UI.labelEur.className = isEuro ? 'active-text' : 'inactive-text';
	UI.totalUnit.innerText = isEuro ? '€' : 'kWh';
	renderData();
}

function setView(view) {
	isTable = (view === 'table');
	UI.chartContainer.style.display = isTable ? 'none' : 'block';
	UI.tableContainer.style.display = isTable ? 'block' : 'none';
	renderData();
}

function setMode(mode) {
	currentMode = mode;
	UI.customDatePanel.style.display = (mode === 'custom') ? 'flex' : 'none';
	if (mode === 'custom' && !UI.customStart.value) {
		UI.customStart.value = baseDate.subtract(6, 'day').format('YYYY-MM-DD');
		UI.customEnd.value = baseDate.format('YYYY-MM-DD');
	}
	localStorage.setItem('consumptionMode', mode);
	fetchData();
}

function snapToLatest() {
	baseDate = dayjs(LATEST_DATE);
	if (currentMode !== 'day') {
		document.getElementById('modeDay').checked = true;
		setMode('day');
	} else fetchData();
}

function shiftDate(dir) {
	if (currentMode === 'custom') return;
	const shifts = {
		day: () => baseDate.add(dir, 'day'),
		week: () => baseDate.add(dir * 7, 'day'),
		month: () => baseDate.add(dir, 'month'),
		year: () => baseDate.add(dir, 'year')
	};
	const newDate = shifts[currentMode]();
	const latest = dayjs(LATEST_DATE);
	baseDate = newDate.isAfter(latest) ? latest : newDate;
	fetchData();
}

function getTimeTemplate(start, end, mode) {
	let t = [],
		curr = dayjs(start);
	if (mode === 'hour') {
		for (let i = 0; i < 24; i++) {
			const h = String(i).padStart(2, '0');
			const nextH = String((i + 1) % 24).padStart(2, '0');
			t.push({
				key: `${curr.format('YYYY-MM-DD')} ${h}:00`,
				label: h,
				fullDate: `${h}:00 - ${nextH}:00`,
				usage: 0,
				cost: 0
			});
		}
	} else if (mode === 'day') {
		while (curr.isBefore(end) || curr.isSame(end, 'day')) {
			t.push({
				key: curr.format('YYYY-MM-DD'),
				label: currentMode === 'week' ? curr.format('ddd') : curr.format('D'),
				fullDate: `${curr.format('ddd')}, ${curr.format('DD.MM.YYYY')}`,
				usage: 0,
				cost: 0
			});
			curr = curr.add(1, 'day');
		}
	} else if (mode === 'month') {
		for (let i = 0; i < 12; i++) {
			const monthDate = curr.month(i).startOf('month');
			t.push({
				key: monthDate.format('YYYY-MM'),
				label: monthDate.format('MMM'),
				fullDate: monthDate.format('MMMM YYYY'),
				usage: 0,
				cost: 0
			});
		}
	}
	return t;
}

async function fetchData() {
	const bounds = {
		day: {
			g: 'hour',
			s: baseDate.startOf('day'),
			e: baseDate.startOf('day')
		},
		week: {
			g: 'day',
			s: baseDate.startOf('week').add(1, 'day'),
			e: baseDate.startOf('week').add(7, 'day')
		},
		month: {
			g: 'day',
			s: baseDate.startOf('month'),
			e: baseDate.endOf('month').startOf('day')
		},
		year: {
			g: 'month',
			s: baseDate.startOf('year'),
			e: baseDate.endOf('year').startOf('day')
		},
		custom: {
			g: 'day',
			s: dayjs(UI.customStart.value).startOf('day'),
			e: dayjs(UI.customEnd.value).startOf('day')
		}
	};

	const groupby = bounds[currentMode].g;
	const start = bounds[currentMode].s;
	const end = bounds[currentMode].e;
	if (currentMode === 'custom') baseDate = start;

	UI.dateRangeDisplay.innerText = currentMode === 'day' ?
		start.format('MMMM D, YYYY') :
		`${start.format('MMMM D, YYYY')} - ${end.format('MMMM D, YYYY')}`;

	try {
		const url = `/api/consumption_chart?start=${start.format('YYYY-MM-DD')}&end=${end.format('YYYY-MM-DD')}&groupby=${groupby}`;
		const apiData = (await ApiManager.fetch(url, url, false)) || [];

		currentData = getTimeTemplate(start, end, groupby).map(t => {
			const match = apiData.find(d => d.key === t.key);
			return {
				...t,
				...(match || {}),
				cost: match ? match.cost : 0
			};
		});

		renderData();
	} catch (err) {
		console.error(err);
	}
}

function renderData() {
	const modeToGranularity = {
		day: 'hour',
		week: 'day',
		month: 'day',
		year: 'month',
		custom: 'day'
	};
	const granularity = modeToGranularity[currentMode];

	const stats = currentData.reduce((acc, d) => {
		const varCost = d.cost + (d.usage * AppState.delta);
		const preciseFee = AppState.getProportionalFee(granularity, d.key);
		const standingFee = (AppState.includeFee && d.usage > 0) ? preciseFee : 0;

		return {
			u: acc.u + d.usage,
			c: acc.c + varCost + standingFee,
			hasData: acc.hasData || d.usage > 0
		};
	}, {
		u: 0,
		c: 0,
		hasData: false
	});

	UI.totalValue.innerText = (isEuro ? stats.c : stats.u).toLocaleString(undefined, {
		minimumFractionDigits: isEuro ? 2 : 3,
		maximumFractionDigits: isEuro ? 2 : 3
	});

	if (isTable) {
		UI.tableBody.innerHTML = stats.hasData ? currentData.filter(d => d.usage > 0).map(d => {
			const varCost = d.cost + (d.usage * AppState.delta);
			return `<tr><td class="text-left">${d.fullDate}</td><td>${d.usage.toFixed(3)}</td><td>${varCost.toFixed(2)}</td></tr>`;
		}).join('') : '<tr><td colspan="3" class="text-center p-30 text-muted text-bold">No Data Available</td></tr>';
		return;
	}

	UI.noDataOverlay.style.display = stats.hasData ? 'none' : 'flex';

	const labels = currentData.map(d => d.label);
	const dataValues = currentData.map(d => isEuro ? (d.cost + (d.usage * AppState.delta)) : d.usage);

	if (myChart) {
		myChart.data.labels = labels;
		myChart.data.datasets[0].data = dataValues;
		myChart.options.scales.y.title.text = isEuro ? '€' : 'kWh';
		myChart.options.plugins.tooltip.callbacks.label = ctx => ` ${ctx.parsed.y.toFixed(isEuro ? 2 : 3)} ${isEuro ? '€' : 'kWh'}`;
		myChart.update();
	} else {
		myChart = new Chart(UI.chartCtx, {
			type: 'bar',
			data: {
				labels: labels,
				datasets: [{
					data: dataValues,
					backgroundColor: '#ff8af3',
					borderRadius: 4
				}]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				interaction: {
					mode: 'index',
					intersect: false
				},
				onHover: (e, el) => e.native.target.style.cursor = (el.length && currentMode !== 'day') ? 'pointer' : 'default',
				onClick: (e, elements) => {
					if (!elements.length) return;
					baseDate = dayjs(currentData[elements[0].index].key + (currentMode === 'year' ? "-01T12:00:00" : "T12:00:00"));
					document.getElementById(currentMode === 'year' ? 'modeMonth' : 'modeDay').checked = true;
					setMode(currentMode === 'year' ? 'month' : 'day');
				},
				plugins: {
					legend: {
						display: false
					},
					tooltip: {
						callbacks: {
							title: ctx => currentData[ctx[0].dataIndex].fullDate,
							label: ctx => ` ${ctx.parsed.y.toFixed(isEuro ? 2 : 3)} ${isEuro ? '€' : 'kWh'}`
						}
					}
				},
				scales: {
					x: {
						grid: {
							display: false
						}
					},
					y: {
						grid: {
							color: 'rgba(255,255,255,0.05)',
							borderDash: [5, 5]
						},
						title: {
							display: true,
							text: isEuro ? '€' : 'kWh'
						}
					}
				}
			}
		});
	}
}

async function triggerRefresh() {
	const btn = document.getElementById('refreshBtn');
	const res = await runDataSync(btn, 3);
	if (res.success && res.hasChanges) {
		ApiManager.clearCache();
		fetchData();
	}
	setTimeout(() => {
		if (btn) {
			btn.innerText = "🔄 Refresh Data";
			btn.disabled = false;
		}
	}, 2500);
}

window.onload = () => {
	initDOM();
	initSettings();
	const sm = localStorage.getItem('consumptionMode') || 'day';
	const r = document.getElementById(`mode${sm.charAt(0).toUpperCase() + sm.slice(1)}`);
	if (r) r.checked = true;
	setMode(sm);

	['fixedValue', 'includeFeeToggle', 'monthlyFeeVal'].forEach(id => {
		const el = document.getElementById(id);
		if (el) {
			el.addEventListener('input', (e) => {
				if (e.target.type === 'checkbox') handleSettingsChange(e);
				else debouncedSettingsChange(e);
			});
		}
	});
};