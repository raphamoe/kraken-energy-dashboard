// index.js

const UI = {};
let myChart = null,
	isTomorrow = false,
	rawChartData = [];
let defaultCalcTime = {
	start: "",
	end: ""
};
const pageLoadDate = dayjs().format('YYYY-MM-DD');

const pageSettings = [{
		id: 'fixedValue',
		key: 'userDelta'
	},
	{
		id: 'baselineValue',
		key: 'userBase'
	},
	{
		id: 'spotToggle',
		key: 'idxSpotToggle',
		default: true,
		isCheckbox: true
	},
	{
		id: 'workToggle',
		key: 'idxWorkToggle',
		default: true,
		isCheckbox: true
	}
];

function initDOM() {
	['idxAvg', 'idxMin', 'idxMinTime', 'idxMax', 'idxMaxTime', 'statusPrice', 'statusTime', 'statusPrefix', 'chartTitle', 'optTime', 'optPrice', 'calcStart', 'calcEnd', 'calcPower', 'calcUsage', 'calcCost', 'calcSavings', 'dayTomorrow', 'tomorrowLabel', 'dayToday']
	.forEach(id => UI[id] = document.getElementById(id));
	UI.chartCtx = document.getElementById('energyChart')?.getContext('2d');
}

function initSettings() {
	AppSettings.init(pageSettings);
	updateVisibility();
}

function handleSettingsChange() {
	AppSettings.save(pageSettings);
	updateDashboard();
}

const currentTimeLinePlugin = {
	id: 'currentTimeLine',
	beforeDraw: (chart) => {
		const {
			ctx,
			scales: {
				x,
				y
			}
		} = chart;
		const now = dayjs();
		const timeStr = `${now.format('HH')}:${String(Math.floor(now.minute() / 15) * 15).padStart(2, '0')}`;
		const xPos = x.getPixelForValue(timeStr);
		if (!isNaN(xPos) && xPos >= x.left && xPos <= x.right) {
			ctx.save();
			ctx.beginPath();
			ctx.strokeStyle = '#ffd600';
			ctx.setLineDash([5, 5]);
			ctx.lineWidth = 2;
			ctx.moveTo(xPos, y.top);
			ctx.lineTo(xPos, y.bottom);
			ctx.stroke();
			ctx.restore();
		}
	}
};

function checkTimeAndDisable() {
	const isBeforeRelease = (dayjs().hour() < 13);
	UI.dayTomorrow.disabled = isBeforeRelease;
	UI.tomorrowLabel.title = isBeforeRelease ? "Available after 1:00 PM" : "";
	if (isBeforeRelease && isTomorrow) setTomorrow(false);
}

function setTomorrow(val) {
	isTomorrow = val;
	UI.dayToday.checked = !val;
	UI.dayTomorrow.checked = val;
	UI.chartTitle.innerText = val ? "Tomorrow's Forecast" : "Today's Energy Prices";
	UI.statusPrefix.innerText = val ? "Tomorrow" : "Current";
	updateDashboard();
}

async function updateDashboard() {
	try {
		const queryDate = isTomorrow ? dayjs().add(1, 'day') : dayjs();
		const url = `/api/prices?date=${queryDate.format('YYYY-MM-DD')}`;
		rawChartData = await ApiManager.fetch(url, `idx_${queryDate.format('YYYY-MM-DD')}`);

		if (!rawChartData.length) {
			if (myChart) {
				myChart.destroy();
				myChart = null;
			}
			return ['idxAvg', 'idxMin', 'idxMax', 'statusPrice'].forEach(id => UI[id].innerText = '-- €');
		}

		const stats = {
			min: Infinity,
			max: -Infinity,
			sum: 0,
			minTime: '--:--',
			maxTime: '--:--'
		};
		const chartData = {
			labels: [],
			spot: [],
			work: [],
			base: []
		};

		rawChartData.forEach(d => {
            const price = getIntervalPrice(d, AppState.delta);
            const ts = d[0].split(' ')[1]; // d[0] is timestamp

            if (!isNaN(price)) {
                if (price < stats.min) { stats.min = price; stats.minTime = ts; }
                if (price > stats.max) { stats.max = price; stats.maxTime = ts; }
                stats.sum += price;
            }
            chartData.labels.push(ts);
            chartData.spot.push(parseFloat(d[1]) * TAXES); // d[1] is spot
            chartData.work.push(price.toFixed(4));
            chartData.base.push(AppState.base);
        });

		const avgPrice = stats.sum / rawChartData.length;

		UI.idxAvg.innerText = avgPrice.toFixed(4) + ' €';
		UI.idxMin.innerText = `${stats.min.toFixed(4)} €`;
		UI.idxMinTime.innerText = `at ${stats.minTime}`;
		UI.idxMax.innerText = `${stats.max.toFixed(4)} €`;
		UI.idxMaxTime.innerText = `at ${stats.maxTime}`;

		findOptimalTimeframe(avgPrice);
		renderChart(chartData);
		updateStatus();
	} catch (err) {
		console.error("Dashboard Update Failed:", err);
	}
}

function renderChart(data) {
	if (myChart) {
		myChart.data.labels = data.labels;
		myChart.data.datasets[0].data = data.spot;
		myChart.data.datasets[1].data = data.work;
		myChart.data.datasets[2].data = data.base;
		myChart.update('none');
	} else {
		myChart = new Chart(UI.chartCtx, {
			plugins: [currentTimeLinePlugin],
			data: {
				labels: data.labels,
				datasets: [{
						type: 'line',
						label: 'Spot Price',
						data: data.spot,
						borderColor: '#40C057',
						tension: 0,
						pointRadius: 0,
						yAxisID: 'y',
						hidden: !document.getElementById('spotToggle').checked
					},
					{
						type: 'line',
						label: 'Work Price',
						data: data.work,
						borderColor: '#1971c2',
						backgroundColor: 'rgba(25, 113, 194, 0.1)',
						fill: true,
						tension: 0,
						pointRadius: 0,
						yAxisID: 'y',
						hidden: !document.getElementById('workToggle').checked
					},
					{
						type: 'line',
						label: 'Baseline',
						data: data.base,
						borderColor: '#fa5252',
						borderDash: [5, 5],
						pointRadius: 0,
						yAxisID: 'y'
					}
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				animation: false,
				interaction: {
					mode: 'index',
					intersect: false
				},
				scales: {
					y: {
						position: 'left',
						grid: {
							color: '#334155'
						}
					},
					x: {
						grid: {
							color: '#334155'
						}
					}
				},
				plugins: {
					legend: {
						labels: {
							color: '#e2e8f0',
							usePointStyle: true
						}
					},
					tooltip: {
						filter: item => item.dataset.label !== 'Baseline'
					}
				}
			}
		});
	}
}

function findOptimalTimeframe(dailyAvg) {
	const blocks = rawChartData.reduce((acc, d) => {
		if (getIntervalPrice(d, AppState.delta) < dailyAvg) acc[acc.length - 1].push(d);
		else if (acc[acc.length - 1].length) acc.push([]);
		return acc;
	}, [
		[]
	]).filter(b => b.length).sort((a, b) => b.length - a.length || (a.reduce((s, x) => s + getIntervalPrice(x, AppState.delta), 0) / a.length) - (b.reduce((s, x) => s + getIntervalPrice(x, AppState.delta), 0) / b.length));

	const bestBlock = blocks[0] || rawChartData;
    const startTs = bestBlock[0][0].split(' ')[1].substring(0, 5); // Index 0 of bestBlock, then Index 0 for timestamp
    const lastTime = bestBlock[bestBlock.length - 1][0].split(' ')[1];
	const endTs = dayjs(`2000-01-01 ${lastTime}`).add(15, 'minute').format('HH:mm');

	UI.optTime.innerText = `${startTs} to ${endTs}`;
	UI.optPrice.innerText = `${(bestBlock.reduce((s, x) => s + getIntervalPrice(x, AppState.delta), 0) / bestBlock.length).toFixed(4)} €/kWh`;

	defaultCalcTime = {
		start: startTs,
		end: endTs
	};
	if (!UI.calcStart.value) UI.calcStart.value = startTs;
	if (!UI.calcEnd.value) UI.calcEnd.value = endTs;
	runCalculator();
}

function runCalculator() {
    const sMins = (h => h[0] * 60 + h[1])((UI.calcStart.value || defaultCalcTime.start).split(':').map(Number));
    const eMins = (h => h[0] * 60 + h[1])((UI.calcEnd.value || defaultCalcTime.end).split(':').map(Number)) + (sMins >= (UI.calcEnd.value || defaultCalcTime.end).split(':').map(Number)[0] * 60 + (UI.calcEnd.value || defaultCalcTime.end).split(':').map(Number)[1] ? 1440 : 0);
    const totalKwh = (parseFloat(UI.calcPower.value) || 0) * ((eMins - sMins) / 60);

    const validIntervals = rawChartData.map(d => {
        const m = (h => h[0] * 60 + h[1])(d[0].split(' ')[1].split(':').map(Number)); // d[0] is timestamp
        return (m >= sMins && m < eMins) || (eMins > 1440 && m < eMins - 1440) ? getIntervalPrice(d, AppState.delta) : null;
    }).filter(p => p !== null);

    // Only declared once, correctly using the d[0] tuple syntax
    const avgPrice = validIntervals.length ? validIntervals.reduce((a, b) => a + b) / validIntervals.length :
        getIntervalPrice(rawChartData.reduce((p, c) => Math.abs(((h => h[0] * 60 + h[1])(c[0].split(' ')[1].split(':').map(Number))) - sMins) < Math.abs(((h => h[0] * 60 + h[1])(p[0].split(' ')[1].split(':').map(Number))) - sMins) ? c : p), AppState.delta);

    const totalCost = totalKwh * avgPrice;
    const savings = (totalKwh * AppState.base) - totalCost;

    UI.calcUsage.innerText = totalKwh.toFixed(2) + " kWh";
    UI.calcCost.innerText = totalCost.toFixed(2) + " €";
    UI.calcSavings.innerText = savings.toFixed(2) + " €";
    UI.calcSavings.className = `ml-5-bold ${savings >= 0 ? "text-primary" : "text-danger"}`;
}

function updateStatus() {
	if (!rawChartData.length) return;
	const now = dayjs();
	const timeTarget = `${now.format('HH')}:${String(Math.floor(now.minute() / 15) * 15).padStart(2, '0')}`;
    const entry = rawChartData.find(d => d[0].endsWith(timeTarget)); // d[0] is timestamp
	const price = entry ? getIntervalPrice(entry, AppState.delta) : 0;

	UI.statusTime.innerText = `(${now.format('HH:mm')})`;
	UI.statusPrice.innerText = price.toFixed(4) + ' €';
	UI.statusPrice.className = price < AppState.base ? "text-primary" : "text-danger";
}

function updateVisibility() {
    AppSettings.save(pageSettings);
    if (myChart && myChart.data.datasets.length >= 2) {
        myChart.setDatasetVisibility(0, document.getElementById('spotToggle').checked);
        myChart.setDatasetVisibility(1, document.getElementById('workToggle').checked);
        myChart.update(); 
        updateStatus();
    }
}

async function syncData() {
	const btn = document.getElementById('refreshBtn');
	if (await runDataSync(btn, 0)) {
		ApiManager.clearCache();
		setTimeout(updateDashboard, 3000);
	}
}

setInterval(() => {
	if (myChart) {
		updateStatus();
		myChart.update('none');
	}
}, 60000);
setInterval(updateDashboard, 300000);
setInterval(() => {
	if (dayjs().format('YYYY-MM-DD') !== pageLoadDate) location.reload();
}, 60000);
setInterval(checkTimeAndDisable, 60000);

window.onload = () => {
	initDOM();
	initSettings();
	checkTimeAndDisable();
	updateDashboard();
};