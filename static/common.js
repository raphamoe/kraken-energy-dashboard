// common.js

const AppState = {
	delta: 0,
	base: 0, // Removed hardcoded 0.3136. Will be populated by the UI.
	fee: 0,  // Removed hardcoded 15.20. Will be populated by the UI.
	includeFee: false,

	update() {
		const dEl = document.getElementById('fixedValue') || document.getElementById('deltaVal');
		const bEl = document.getElementById('baselineValue') || document.getElementById('baseVal');
		const fEl = document.getElementById('monthlyFeeVal');
		const incEl = document.getElementById('includeFeeToggle');

		if (dEl) this.delta = parseFloat(dEl.value) || 0;
        
		// We use `|| this.base` so if a page is missing the input, 
        // it doesn't accidentally wipe out the state to 0.
		if (bEl) this.base = parseFloat(bEl.value) || this.base;
		if (fEl) this.fee = parseFloat(fEl.value) || this.fee;
		if (incEl) this.includeFee = incEl.checked;
	},

	getProportionalFee(granularity, dateString = null) {
		if (!this.includeFee) return 0;

		// 1. If no date is provided, fallback to the flattened average (useful for broad stats)
		if (!dateString) {
			const yearly = this.fee * 12;
			switch (granularity) {
				case 'hour':
					return yearly / 8760;
				case 'day':
					return yearly / 365.25;
				case 'week':
					return yearly / 52.17;
				case 'month':
					return this.fee;
				case 'year':
					return yearly;
				default:
					return 0;
			}
		}

		// 2. Calendar-Aware Precise Math
		const daysInMonth = dayjs(dateString).daysInMonth();
		const preciseDailyRate = this.fee / daysInMonth;

		switch (granularity) {
			case 'hour':
				return preciseDailyRate / 24;
			case 'day':
				return preciseDailyRate;
			case 'week':
				return preciseDailyRate * 7;
			case 'month':
				return this.fee;
			case 'year':
				return this.fee * 12;
			default:
				return 0;
		}
	}
};

const ApiManager = {
	memoryCache: new Map(),
	async fetch(url, cacheKey, useLocalStorage = false) {
		if (this.memoryCache.has(cacheKey)) return this.memoryCache.get(cacheKey);
		const syncVer = useLocalStorage ? (localStorage.getItem('lastSync') || '0') : null;

		if (useLocalStorage) {
			const cached = localStorage.getItem(cacheKey);
			if (cached) {
				try {
					const parsed = JSON.parse(cached);
					if (parsed.v === syncVer) {
						this.memoryCache.set(cacheKey, parsed.d);
						return parsed.d;
					}
				} catch (e) {
					console.warn("Cache parse error", e);
				}
			}
		}

		try {
			const res = await fetch(url);
			const data = await res.json();
			this.memoryCache.set(cacheKey, data);
			if (useLocalStorage) {
				try {
					localStorage.setItem(cacheKey, JSON.stringify({
						v: syncVer,
						d: data
					}));
				} catch (e) {
					console.warn("Local storage full or disabled", e);
				}
			}
			return data;
		} catch (err) {
			console.error(`Fetch failed for ${url}:`, err);
			throw err;
		}
	},
	clearCache() {
		this.memoryCache.clear();
	}
};

async function runDataSync(btnElement, daysBack = 0, force = false) {
	if (btnElement && btnElement.disabled) return {
		success: false,
		hasChanges: false
	};

	if (btnElement) {
		btnElement.disabled = true;
		btnElement.innerText = force ? "🚨 Force Syncing..." : "⏳ Syncing...";
	}

	try {
		const forceParam = force ? '&force=true' : '';
		const timestamp = `&t=${Date.now()}`;
		const responses = await Promise.all([
			fetch(`/api/sync/work?${timestamp}`),
			fetch(`/api/sync/spot?days=${daysBack}${timestamp}${forceParam}`),
			fetch(`/api/sync/usage?days=${daysBack}${timestamp}${forceParam}`)
		]);

		if (responses.some(res => !res.ok)) throw new Error("Sync failed");

		const data = await Promise.all(responses.map(r => r.json()));
		const totalChanges = data.reduce((sum, d) => sum + (d.rows_added || 0), 0);
		const hasChanges = totalChanges > 0;

		if (btnElement) btnElement.innerHTML = hasChanges ? `✅ Added ${totalChanges} rows` : "✅ Up to date";
		if (hasChanges) localStorage.setItem('lastSync', Date.now().toString());

		return {
			success: true,
			hasChanges
		};
	} catch (err) {
		console.error("Sync Error:", err);
		if (btnElement) btnElement.innerHTML = "❌ Error";
		return {
			success: false,
			hasChanges: false
		};
	}
}

const AppSettings = {
	UI: {
		display: null
	},
	init(configArray) {
		this.UI.display = document.getElementById('simFixedDisplay');
		configArray.forEach(item => {
			const el = document.getElementById(item.id);
			if (!el) return;
			const saved = localStorage.getItem(item.key);
			if (item.isCheckbox) {
				el.checked = saved !== null ? (saved === 'true') : item.default;
			} else if (saved !== null) {
				el.value = saved;
			}
		});
		AppState.update();
		this.updateDisplay();
	},
	save(configArray) {
		configArray.forEach(item => {
			const el = document.getElementById(item.id);
			if (!el) return;
			localStorage.setItem(item.key, item.isCheckbox ? el.checked : el.value);
		});
		AppState.update();
		this.updateDisplay();
	},
	updateDisplay() {
		if (this.UI.display && typeof BASE_FIXED !== 'undefined') {
			this.UI.display.innerText = `(Total Fixed: ${(BASE_FIXED + AppState.delta).toFixed(3)} €)`;
		}
	}
};

function getIntervalPrice(d, customDelta = 0) {
    if (!d) return NaN;
    
    // d[0] = timestamp
    // d[1] = spot_price
    // d[2] = usage
    // d[3] = work_price (Optional)

    if (d[3] !== undefined && d[3] !== null) {
        return parseFloat(d[3]) + customDelta;
    } 
    if (d[1] !== undefined && d[1] !== null) {
        return (parseFloat(d[1]) * TAXES) + BASE_FIXED + customDelta;
    }
    return NaN;
}

function toggleSettings() {
	const menu = document.getElementById('settingsMenu');
	if (menu) menu.classList.toggle('active');
}

if (typeof Chart !== 'undefined' && Chart.Tooltip) {
	Chart.Tooltip.positioners.cursor = (elements, eventPosition) => ({
		x: eventPosition.x,
		y: eventPosition.y
	});
}