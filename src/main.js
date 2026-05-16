import { Decoder, Stream } from '@garmin/fitsdk';
import './style.css';

const TRAINING_ZONES_STORAGE_KEY = 'my-fit-training-zones';

class FitInterpreter {
  constructor(messages) {
    this.messages = messages;
    this.intervals = [];
    this.startTime = null;
    this.endTime = null;
  }

  getSummary() {
    let summary = null;

    for (const message of this.messages) {
      let endTime = null;
      if (message.event === 'timer' && message.eventType === 'start') {
        this.startTime = message.timestamp;
      }
      if (message.event === 'timer' && message.eventType === 'stopAll') {
        this.endTime = message.timestamp;
      }
      if (message.avgSpeed != null) {
        summary = message;
      }
    }

    return { startTime: this.startTime, endTime: this.endTime, duration: this.startTime && this.endTime ? (this.endTime - this.startTime) : null, ...summary };
  }

  setInterval(interval) {
    this.intervals.push(interval);
  }

  getIntervalsSummary() {
    if (this.intervals.length === 0) {
      return [];
    }
    let recordCount = 0;
    let currentIntervalIndex = 0;
    let intervalFinalSecond = this.intervals[0].totalSeconds;

    let sumHeartRate = 0;
    let maxHeartRate = 0;
    let previousHeartRate = 0;

    let sumEnhancedSpeed = 0;
    let maxEnhancedSpeed = 0;
    let previousEnhancedSpeed = 0;

    let sumCadence = 0;
    let maxCadence = 0;
    let previousCadence = 0;

    let sumStepLength = 0;
    let maxStepLength = 0;
    let previousStepLength = 0;

    for (const message of this.messages) {
      if (message.type !== 'record') {
        continue;
      }
      recordCount++;

      if (message.heartRate != null) {
        sumHeartRate += message.heartRate;
        maxHeartRate = Math.max(maxHeartRate, message.heartRate);
        previousHeartRate = message.heartRate;
      } else if (previousHeartRate > 0) {
        sumHeartRate += previousHeartRate;
      }

      if (message.enhancedSpeed != null) {
        sumEnhancedSpeed += message.enhancedSpeed;
        maxEnhancedSpeed = Math.max(maxEnhancedSpeed, message.enhancedSpeed);
        previousEnhancedSpeed = message.enhancedSpeed;
      } else if (previousEnhancedSpeed > 0) {
        sumEnhancedSpeed += previousEnhancedSpeed;
      }

      if (message.cadence != null) {
        sumCadence += message.cadence;
        maxCadence = Math.max(maxCadence, message.cadence);
        previousCadence = message.cadence;
      } else if (previousCadence > 0) {
        sumCadence += previousCadence;
      }

      if (message.stepLength != null) {
        sumStepLength += message.stepLength;
        maxStepLength = Math.max(maxStepLength, message.stepLength);
        previousStepLength = message.stepLength;
      } else if (previousStepLength > 0) {
        sumStepLength += previousStepLength;
      }

      const elapsedSeconds = message.timestamp && this.startTime ? Math.floor((message.timestamp - this.startTime) / 1000) : null;

      if (elapsedSeconds > intervalFinalSecond) {
        let currentInterval = this.intervals[currentIntervalIndex];
        currentInterval.avgHeartRate = sumHeartRate / recordCount;
        currentInterval.maxHeartRate = maxHeartRate;

        currentInterval.avgEnhancedSpeed = sumEnhancedSpeed / recordCount;
        currentInterval.maxEnhancedSpeed = maxEnhancedSpeed;

        currentInterval.avgCadence = sumCadence / recordCount;
        currentInterval.maxCadence = maxCadence;

        currentInterval.avgStepLength = sumStepLength / recordCount;
        currentInterval.maxStepLength = maxStepLength;

        sumHeartRate = 0;
        maxHeartRate = 0;
        sumEnhancedSpeed = 0;
        maxEnhancedSpeed = 0;
        sumCadence = 0;
        maxCadence = 0;
        sumStepLength = 0;
        maxStepLength = 0;
        recordCount = 0;

        currentIntervalIndex++;
        if (currentIntervalIndex == this.intervals.length) {
          break;
        }
        intervalFinalSecond += this.intervals[currentIntervalIndex].totalSeconds;
      }
    }

    if (maxHeartRate > 0 && currentIntervalIndex < this.intervals.length) {
      let currentInterval = this.intervals[currentIntervalIndex++];
      let totalSeconds = recordCount;
      for (let i = 0; i < this.intervals.length - 1; i++) {
        totalSeconds -= this.intervals[i].totalSeconds;
      }
      currentInterval.avgHeartRate = sumHeartRate / totalSeconds;
      currentInterval.maxHeartRate = maxHeartRate;

      currentInterval.avgEnhancedSpeed = sumEnhancedSpeed / totalSeconds;
      currentInterval.maxEnhancedSpeed = maxEnhancedSpeed;

      currentInterval.avgCadence = sumCadence / totalSeconds;
      currentInterval.maxCadence = maxCadence;

      currentInterval.avgStepLength = sumStepLength / totalSeconds;
      currentInterval.maxStepLength = maxStepLength;

      currentInterval.totalSeconds = totalSeconds;
    }

    return this.intervals;
  }

  getHeartRateSeries() {
    const heartRateMessages = this.messages.filter((message) => message.heartRate != null);

    return heartRateMessages.map((message, index) => ({
      heartRate: message.heartRate,
      elapsedSeconds: index,
      timestamp: message.timestamp ?? null,
    }));
  }

  getPaceSeries() {
    const paceMessages = this.messages.filter((message) => message.enhancedSpeed != null && message.enhancedSpeed > 0);

    return paceMessages.map((message, index) => ({
      paceSecondsPerKilometer: 1000 / message.enhancedSpeed,
      elapsedSeconds: index,
      timestamp: message.timestamp ?? null,
    }));
  }

  getIntervalBoundaries(totalSamples) {
    if (!Number.isInteger(totalSamples) || totalSamples <= 1 || this.intervals.length === 0) {
      return [];
    }

    const boundaries = [];
    let cumulativeSamples = 0;

    for (const interval of this.intervals) {
      cumulativeSamples += interval.totalSeconds;

      if (cumulativeSamples >= totalSamples) {
        break;
      }

      boundaries.push({
        name: interval.name,
        sampleIndex: cumulativeSamples,
        elapsedTotalSeconds: cumulativeSamples,
      });
    }

    return boundaries;
  }
}

class FitDecoderService {
  getMessages(arrayBuffer) {
    const stream = Stream.fromArrayBuffer(arrayBuffer);
    const decoder = new Decoder(stream);

    if (!decoder.isFIT()) {
      throw new Error('The selected file is not a valid FIT file.');
    }

    const { messages, errors } = decoder.read();

    for (let i = 0; i < messages.recordMesgs.length; i++) {
      const message = messages.recordMesgs[i];
      message.type = "record";
    }

    if (errors.length > 0) {
      throw new Error(errors[0].message ?? 'The FIT file could not be decoded.');
    }

    return Object.values(messages).flat();
  }
}

class FitUploadApp {
  constructor(decoderService, interpreter) {
    this.decoderService = decoderService;
    this.interpreter = interpreter;
    this.trainingZones = null;
    this.currentHeartRateSeries = [];
    this.currentPaceSeries = [];
    this.resultsElement = document.querySelector('[data-role="results"]');
    this.summaryGroupsElement = document.querySelector('[data-role="summary-groups"]');
    this.statusElement = null;
    this.messageCountElement = null;
    this.fileNameElement = null;
    this.intervalFormElement = null;
    this.intervalNameElement = null;
    this.intervalSecondsElement = null;
    this.intervalFeedbackElement = null;
    this.intervalListElement = null;
    this.copySummaryButtonElement = null;
    this.zonesFormElement = null;
    this.zonesFeedbackElement = null;
    this.zoneInputs = null;
    this.heartRateSectionElement = null;
    this.heartRateChartElement = null;
    this.heartRateCaptionElement = null;
    this.paceSectionElement = null;
    this.paceChartElement = null;
    this.paceCaptionElement = null;
  }

  initialize() {
    this.statusElement = document.querySelector('[data-role="status"]');
    this.messageCountElement = document.querySelector('[data-role="message-count"]');
    this.fileNameElement = document.querySelector('[data-role="file-name"]');
    this.intervalFormElement = document.querySelector('[data-role="interval-form"]');
    this.intervalNameElement = document.querySelector('[data-role="interval-name"]');
    this.intervalSecondsElement = document.querySelector('[data-role="interval-seconds"]');
    this.intervalFeedbackElement = document.querySelector('[data-role="interval-feedback"]');
    this.intervalListElement = document.querySelector('[data-role="interval-list"]');
    this.copySummaryButtonElement = document.querySelector('[data-role="copy-summary-button"]');
    this.zonesFormElement = document.querySelector('[data-role="zones-form"]');
    this.zonesFeedbackElement = document.querySelector('[data-role="zones-feedback"]');
    this.zoneInputs = {
      z1: document.querySelector('[data-role="zone-z1"]'),
      z2: document.querySelector('[data-role="zone-z2"]'),
      z3: document.querySelector('[data-role="zone-z3"]'),
      z4: document.querySelector('[data-role="zone-z4"]'),
    };
    this.heartRateSectionElement = document.querySelector('[data-role="heart-rate-section"]');
    this.heartRateChartElement = document.querySelector('[data-role="heart-rate-chart"]');
    this.heartRateCaptionElement = document.querySelector('[data-role="heart-rate-caption"]');
    this.paceSectionElement = document.querySelector('[data-role="pace-section"]');
    this.paceChartElement = document.querySelector('[data-role="pace-chart"]');
    this.paceCaptionElement = document.querySelector('[data-role="pace-caption"]');

    const fileInput = document.querySelector('#fit-file');
    fileInput.addEventListener('change', (event) => {
      this.handleFileSelection(event).catch((error) => {
        this.showResults();
        this.updateStatus(error.message, true);
        this.messageCountElement.textContent = '-';
        this.clearSummary();
      });
    });

    this.intervalFormElement.addEventListener('submit', (event) => {
      this.handleIntervalSubmit(event);
    });

    Object.values(this.zoneInputs).forEach((input) => {
      input.addEventListener('input', () => {
        this.handleZonesInput();
      });
    });

    this.restoreTrainingZones();

    this.copySummaryButtonElement.addEventListener('click', () => {
      this.handleCopySummary().catch((e) => {
        this.updateIntervalFeedback('Unable to copy the summary to the clipboard.', true);
        console.error('Clipboard copy failed:', e);
      });
    });

    this.renderIntervals();
  }

  handleZonesInput() {
    this.persistTrainingZones();

    const zones = {
      z1: this.parseZoneInput(this.zoneInputs.z1.value),
      z2: this.parseZoneInput(this.zoneInputs.z2.value),
      z3: this.parseZoneInput(this.zoneInputs.z3.value),
      z4: this.parseZoneInput(this.zoneInputs.z4.value),
    };

    if (Object.values(zones).every((value) => value == null)) {
      this.trainingZones = null;
      this.updateZonesFeedback('Enter all four zone limits to draw them on the chart.');
      this.renderHeartRateChart(this.currentHeartRateSeries);
      return;
    }

    if (Object.values(zones).some((value) => value == null)) {
      this.trainingZones = null;
      this.updateZonesFeedback('Enter all four zone limits to draw the zone lines.', true);
      this.renderHeartRateChart(this.currentHeartRateSeries);
      return;
    }

    if (!(zones.z1 < zones.z2 && zones.z2 < zones.z3 && zones.z3 < zones.z4)) {
      this.trainingZones = null;
      this.updateZonesFeedback('Zone limits must be in ascending order: Z1 < Z2 < Z3 < Z4.', true);
      this.renderHeartRateChart(this.currentHeartRateSeries);
      return;
    }

    this.trainingZones = zones;
    this.updateZonesFeedback(`Showing zone lines for Z1 ${zones.z1}, Z2 ${zones.z2}, Z3 ${zones.z3}, Z4 ${zones.z4}.`);
    this.renderHeartRateChart(this.currentHeartRateSeries);
  }

  persistTrainingZones() {
    const storedZones = {
      z1: this.zoneInputs.z1.value,
      z2: this.zoneInputs.z2.value,
      z3: this.zoneInputs.z3.value,
      z4: this.zoneInputs.z4.value,
    };

    localStorage.setItem(TRAINING_ZONES_STORAGE_KEY, JSON.stringify(storedZones));
  }

  restoreTrainingZones() {
    const savedZones = localStorage.getItem(TRAINING_ZONES_STORAGE_KEY);

    if (!savedZones) {
      return;
    }

    try {
      const parsedZones = JSON.parse(savedZones);

      Object.entries(this.zoneInputs).forEach(([zoneName, input]) => {
        if (typeof parsedZones[zoneName] === 'string') {
          input.value = parsedZones[zoneName];
        }
      });

      this.handleZonesInput();
    } catch {
      localStorage.removeItem(TRAINING_ZONES_STORAGE_KEY);
    }
  }

  async handleFileSelection(event) {
    const [file] = event.target.files;

    if (!file) {
      this.reset();
      return;
    }

    this.showResults();
    this.fileNameElement.textContent = file.name;
    this.messageCountElement.textContent = '...';
    this.updateStatus('Reading file...');

    const buffer = await file.arrayBuffer();
    const messages = this.decoderService.getMessages(buffer);

    this.interpreter = new FitInterpreter(messages);
    const summary = this.interpreter.getSummary();
    this.currentHeartRateSeries = this.interpreter.getHeartRateSeries();
    this.currentPaceSeries = this.interpreter.getPaceSeries();
    this.clearIntervals();

    this.messageCountElement.textContent = String(messages.length);
    this.renderSummary(summary);
    this.renderHeartRateChart(this.currentHeartRateSeries);
    this.renderPaceChart(this.currentPaceSeries);
    this.updateStatus('Decoded successfully.');
  }

  reset() {
    this.resultsElement.hidden = true;
    this.fileNameElement.textContent = 'No file selected';
    this.messageCountElement.textContent = '-';
    this.currentHeartRateSeries = [];
    this.currentPaceSeries = [];
    this.clearSummary();
    this.clearHeartRateChart();
    this.clearPaceChart();
    this.clearIntervals();
    this.updateStatus('Waiting for upload');
  }

  showResults() {
    this.resultsElement.hidden = false;
  }

  updateStatus(message, isError = false) {
    this.statusElement.textContent = message;
    this.statusElement.dataset.state = isError ? 'error' : 'ready';
  }

  clearSummary() {
    this.summaryGroupsElement.innerHTML = '';
  }

  clearHeartRateChart() {
    this.heartRateSectionElement.hidden = true;
    this.heartRateChartElement.innerHTML = '';
    this.heartRateCaptionElement.textContent = 'No chart data available.';
  }

  clearPaceChart() {
    this.paceSectionElement.hidden = true;
    this.paceChartElement.innerHTML = '';
    this.paceCaptionElement.textContent = 'No pace data available.';
  }

  renderHeartRateChart(heartRateSeries) {
    if (heartRateSeries.length === 0 && this.currentPaceSeries.length === 0) {
      this.clearHeartRateChart();
      return;
    }

    const sampledSeries = this.sampleHeartRateSeries(heartRateSeries, 120);
    const sampledPaceSeries = this.sampleHeartRateSeries(this.currentPaceSeries, 120);
    const intervalBoundaries = this.interpreter instanceof FitInterpreter
      ? this.interpreter.getIntervalBoundaries(heartRateSeries.length)
      : [];
    const chartMarkup = this.buildCombinedChartMarkup(sampledSeries, sampledPaceSeries, this.trainingZones, {
      totalSamples: heartRateSeries.length,
      intervalBoundaries,
    });
    const minHeartRate = Math.min(...heartRateSeries.map((point) => point.heartRate));
    const maxHeartRate = Math.max(...heartRateSeries.map((point) => point.heartRate));
    const paceCaption = this.currentPaceSeries.length > 0
      ? (() => {
        const minPace = Math.min(...this.currentPaceSeries.map((point) => point.paceSecondsPerKilometer));
        const maxPace = Math.max(...this.currentPaceSeries.map((point) => point.paceSecondsPerKilometer));
        return `Pace ${this.currentPaceSeries.length} samples, ${this.formatPaceFromSeconds(minPace)}-${this.formatPaceFromSeconds(maxPace)}`;
      })()
      : 'Pace unavailable';

    this.heartRateSectionElement.hidden = false;
    this.heartRateChartElement.innerHTML = chartMarkup;
    this.heartRateCaptionElement.textContent = `Heart Rate ${heartRateSeries.length} samples, ${minHeartRate}-${maxHeartRate} bpm | ${paceCaption}`;
  }

  renderPaceChart(paceSeries) {
    this.clearPaceChart();
  }

  sampleHeartRateSeries(series, targetPoints) {
    if (series.length <= targetPoints) {
      return series;
    }

    const sampledSeries = [];
    const lastIndex = series.length - 1;

    for (let index = 0; index < targetPoints; index += 1) {
      const sourceIndex = Math.round((index / (targetPoints - 1)) * lastIndex);
      sampledSeries.push(series[sourceIndex]);
    }

    return sampledSeries;
  }

  buildHeartRateChartMarkup(series, zones = null, chartMetadata = {}) {
    const width = 640;
    const height = 220;
    const padding = { top: 16, right: 16, bottom: 28, left: 16 };
    const { totalSamples = series.length, intervalBoundaries = [] } = chartMetadata;
    const values = series.map((point) => point.heartRate);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const valueRange = Math.max(maxValue - minValue, 1);
    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;

    const points = series.map((point, index) => {
      const x = padding.left + (series.length === 1 ? innerWidth / 2 : (index / (series.length - 1)) * innerWidth);
      const y = padding.top + ((maxValue - point.heartRate) / valueRange) * innerHeight;
      return { x, y };
    });

    const linePath = points
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      .join(' ');
    const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(2)} ${(height - padding.bottom).toFixed(2)} L ${points[0].x.toFixed(2)} ${(height - padding.bottom).toFixed(2)} Z`;
    const baselineY = height - padding.bottom;
    const zoneMarkup = this.buildZoneLineMarkup({ zones, width, height, padding, minValue, maxValue, valueRange, innerHeight });
    const intervalMarkup = this.buildIntervalLineMarkup({
      intervalBoundaries,
      totalSamples,
      width,
      height,
      padding,
      innerHeight,
    });

    return `
      <svg class="heart-rate-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Heart rate chart">
        <line class="heart-rate-baseline" x1="${padding.left}" y1="${baselineY}" x2="${width - padding.right}" y2="${baselineY}"></line>
        ${zoneMarkup}
        ${intervalMarkup}
        <path class="heart-rate-area" d="${areaPath}"></path>
        <path class="heart-rate-line" d="${linePath}"></path>
        <text class="heart-rate-label" x="${padding.left}" y="${height - 8}">Start</text>
        <text class="heart-rate-label" x="${width - padding.right}" y="${height - 8}" text-anchor="end">End</text>
      </svg>
    `;
  }

  buildCombinedChartMarkup(heartRateSeries, paceSeries, zones = null, chartMetadata = {}) {
    const width = 640;
    const height = 360;
    const padding = { top: 16, right: 16, bottom: 28, left: 16 };
    const headerHeight = 18;
    const gap = 22;
    const plotHeight = ((height - padding.top - padding.bottom - headerHeight * 2 - gap) / 2);
    const topPlotTop = padding.top + headerHeight;
    const bottomPlotTop = topPlotTop + plotHeight + gap + headerHeight;
    const intervalMarkup = this.buildIntervalLineMarkup({
      intervalBoundaries: chartMetadata.intervalBoundaries ?? [],
      totalSamples: chartMetadata.totalSamples ?? heartRateSeries.length,
      width,
      height,
      padding: { ...padding, top: topPlotTop, bottom: height - (bottomPlotTop + plotHeight) },
      innerHeight: (bottomPlotTop + plotHeight) - topPlotTop,
    });
    const heartRatePlot = heartRateSeries.length > 0
      ? this.buildChartPlotMarkup({
        series: heartRateSeries,
        valueAccessor: (point) => point.heartRate,
        width,
        plotTop: topPlotTop,
        plotHeight,
        padding,
        lineClassName: 'heart-rate-line',
        areaClassName: 'heart-rate-area',
        zones,
      })
      : '';
    const pacePlot = paceSeries.length > 0
      ? this.buildChartPlotMarkup({
        series: paceSeries,
        valueAccessor: (point) => point.paceSecondsPerKilometer,
        width,
        plotTop: bottomPlotTop,
        plotHeight,
        padding,
        lineClassName: 'pace-line',
        areaClassName: 'pace-area',
        invertAxis: true,
      })
      : '';
    const innerWidth = width - padding.left - padding.right;
    const topBaselineY = topPlotTop + plotHeight;
    const bottomBaselineY = bottomPlotTop + plotHeight;

    return `
      <svg class="heart-rate-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Heart rate and pace chart">
        <text class="heart-rate-label" x="${padding.left}" y="${(topPlotTop - 6).toFixed(2)}">Heart Rate</text>
        <text class="heart-rate-label" x="${padding.left}" y="${(bottomPlotTop - 6).toFixed(2)}">Pace</text>
        <line class="heart-rate-baseline" x1="${padding.left}" y1="${topBaselineY.toFixed(2)}" x2="${(padding.left + innerWidth).toFixed(2)}" y2="${topBaselineY.toFixed(2)}"></line>
        <line class="heart-rate-baseline" x1="${padding.left}" y1="${bottomBaselineY.toFixed(2)}" x2="${(padding.left + innerWidth).toFixed(2)}" y2="${bottomBaselineY.toFixed(2)}"></line>
        ${intervalMarkup}
        ${heartRatePlot}
        ${pacePlot}
        <text class="heart-rate-label" x="${padding.left}" y="${height - 8}">Start</text>
        <text class="heart-rate-label" x="${width - padding.right}" y="${height - 8}" text-anchor="end">End</text>
      </svg>
    `;
  }

  buildChartPlotMarkup({
    series,
    valueAccessor,
    width,
    plotTop,
    plotHeight,
    padding,
    lineClassName,
    areaClassName,
    zones = null,
    invertAxis = false,
  }) {
    const values = series.map((point) => valueAccessor(point));
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const valueRange = Math.max(maxValue - minValue, 1);
    const innerWidth = width - padding.left - padding.right;
    const points = series.map((point, index) => {
      const x = padding.left + (series.length === 1 ? innerWidth / 2 : (index / (series.length - 1)) * innerWidth);
      const ratio = invertAxis
        ? (valueAccessor(point) - minValue) / valueRange
        : (maxValue - valueAccessor(point)) / valueRange;
      const y = plotTop + ratio * plotHeight;
      return { x, y };
    });
    const linePath = points
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      .join(' ');
    const baselineY = plotTop + plotHeight;
    const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(2)} ${baselineY.toFixed(2)} L ${points[0].x.toFixed(2)} ${baselineY.toFixed(2)} Z`;
    const zoneMarkup = zones
      ? this.buildZoneLineMarkup({
        zones,
        width,
        height: plotTop + plotHeight,
        padding: { ...padding, top: plotTop, bottom: 0 },
        minValue,
        maxValue,
        valueRange,
        innerHeight: plotHeight,
      })
      : '';

    return `${zoneMarkup}<path class="${areaClassName}" d="${areaPath}"></path><path class="${lineClassName}" d="${linePath}"></path>`;
  }

  buildPaceChartMarkup(series, chartMetadata = {}) {
    const width = 640;
    const height = 220;
    const padding = { top: 16, right: 16, bottom: 28, left: 16 };
    const { totalSamples = series.length, intervalBoundaries = [] } = chartMetadata;
    const values = series.map((point) => point.paceSecondsPerKilometer);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const valueRange = Math.max(maxValue - minValue, 1);
    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;

    const points = series.map((point, index) => {
      const x = padding.left + (series.length === 1 ? innerWidth / 2 : (index / (series.length - 1)) * innerWidth);
      const y = padding.top + ((point.paceSecondsPerKilometer - minValue) / valueRange) * innerHeight;
      return { x, y };
    });

    const linePath = points
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      .join(' ');
    const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(2)} ${(height - padding.bottom).toFixed(2)} L ${points[0].x.toFixed(2)} ${(height - padding.bottom).toFixed(2)} Z`;
    const baselineY = height - padding.bottom;
    const intervalMarkup = this.buildIntervalLineMarkup({
      intervalBoundaries,
      totalSamples,
      width,
      height,
      padding,
      innerHeight,
    });

    return `
      <svg class="heart-rate-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Pace chart">
        <line class="heart-rate-baseline" x1="${padding.left}" y1="${baselineY}" x2="${width - padding.right}" y2="${baselineY}"></line>
        ${intervalMarkup}
        <path class="pace-area" d="${areaPath}"></path>
        <path class="pace-line" d="${linePath}"></path>
        <text class="heart-rate-label" x="${padding.left}" y="${height - 8}">Start</text>
        <text class="heart-rate-label" x="${width - padding.right}" y="${height - 8}" text-anchor="end">End</text>
      </svg>
    `;
  }

  buildZoneLineMarkup({ zones, width, height, padding, minValue, maxValue, valueRange, innerHeight }) {
    if (!zones) {
      return '';
    }

    const zoneDefinitions = [
      { name: 'Z2', limit: zones.z1, color: '#1bd615' },
      { name: 'Z3', limit: zones.z2, color: '#c5cf33' },
      { name: 'Z4', limit: zones.z3, color: '#c28a27' },
      { name: 'Z5', limit: zones.z4, color: '#b54141' },
    ];

    return zoneDefinitions
      .filter((zone) => zone.limit >= minValue && zone.limit <= maxValue)
      .map((zone) => {
        const y = padding.top + ((maxValue - zone.limit) / valueRange) * innerHeight;
        return `
          <line class="heart-rate-zone-line" x1="${padding.left}" y1="${y.toFixed(2)}" x2="${width - padding.right}" y2="${y.toFixed(2)}" stroke="${zone.color}"></line>
          <text class="heart-rate-label heart-rate-zone-label" x="${width - padding.right}" y="${(y - 6).toFixed(2)}" text-anchor="end" fill="${zone.color}">${zone.name} ${zone.limit}</text>
        `;
      })
      .join('');
  }

  buildIntervalLineMarkup({ intervalBoundaries, totalSamples, width, height, padding, innerHeight }) {
    if (intervalBoundaries.length === 0 || totalSamples <= 1) {
      return '';
    }

    return intervalBoundaries
      .map((interval) => {
        const x = padding.left + (interval.sampleIndex / (totalSamples - 1)) * (width - padding.left - padding.right);
        const labelY = Math.max(padding.top - 6, 12);

        return `
          <line class="heart-rate-interval-line" x1="${x.toFixed(2)}" y1="${padding.top}" x2="${x.toFixed(2)}" y2="${(padding.top + innerHeight).toFixed(2)}"></line>
          <text class="heart-rate-label heart-rate-interval-label" x="${x.toFixed(2)}" y="${labelY.toFixed(2)}" text-anchor="middle">${this.formatSecondsDuration(interval.elapsedTotalSeconds)}</text>
        `;
      })
      .join('');
  }

  parseZoneInput(value) {
    if (value.trim() === '') {
      return null;
    }

    const parsedValue = Number.parseInt(value, 10);
    return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : null;
  }

  async handleCopySummary() {
    if (!(this.interpreter instanceof FitInterpreter) || this.interpreter.messages == null) {
      this.updateIntervalFeedback('Upload a FIT file before copying the summary.', true);
      return;
    }
    const summary = this.interpreter.getSummary();
    const intervals = this.interpreter.getIntervalsSummary();

    const exportedIntervals = intervals.length > 0 ? intervals
      .map((interval, index) => `
### ${index + 1}. ${interval.name}
 - Duration: ${this.formatSecondsDuration(interval.totalSeconds)}
 - Average Heart Rate: ${interval.avgHeartRate != null ? `${Math.round(interval.avgHeartRate)} bpm` : '-'}
 - Maximum Heart Rate: ${interval.maxHeartRate != null ? `${interval.maxHeartRate} bpm` : '-'}
 - Average Speed: ${interval.avgEnhancedSpeed != null ? this.formatSpeed(interval.avgEnhancedSpeed) : '-'}
 - Maximum Speed: ${interval.maxEnhancedSpeed != null ? this.formatSpeed(interval.maxEnhancedSpeed) : '-'}
 - Average Cadence: ${interval.avgCadence != null ? `${Math.round(interval.avgCadence * 2)} spm` : '-'}
 - Maximum Cadence: ${interval.maxCadence != null ? `${interval.maxCadence * 2} spm` : '-'}
 - Average Step Length: ${interval.avgStepLength != null ? `${(interval.avgStepLength).toFixed(0)} mm` : '-'}
 - Maximum Step Length: ${interval.maxStepLength != null ? `${(interval.maxStepLength).toFixed(0)} mm` : '-'}
        `)
      .join('')
      : 'No intervals added.';

    const exportData = `
# Workout Summary

### Timing
 - Start Time: ${this.formatDateTime(summary.startTime)}
 - End Time: ${this.formatDateTime(summary.endTime)}
 - Duration: ${this.formatDuration(summary.duration)}

### Activity
 - Sport: ${summary.sport}
 - Sub Sport: ${summary.subSport}
 - Laps(km): ${summary.numLaps}
 - Calories: ${summary.totalCalories} kcal

### Heart Rate
 - Average: ${summary.avgHeartRate} bpm
 - Maximum: ${summary.maxHeartRate} bpm
 - Minimum: ${summary.minHeartRate} bpm

### Distance & Speed
 - Distance: ${this.formatDistance(summary.totalDistance)}
 - Average Speed: ${this.formatSpeed(summary.avgSpeed)}
 - Maximum Speed: ${this.formatSpeed(summary.maxSpeed)}

### Cadence
 - Average Running Cadence: ${summary.avgRunningCadence * 2} spm
 - Maximum Running Cadence: ${summary.maxRunningCadence * 2} spm
 - Average Step Length: ${summary.avgStepLength.toFixed(0)} mm

### Training
 - Training Effect: ${summary.totalTrainingEffect}
 - Anaerobic Effect: ${summary.totalAnaerobicTrainingEffect}
 - Training Load Peak: ${summary.trainingLoadPeak}

## Intervals

${exportedIntervals}
`

    await navigator.clipboard.writeText(exportData);
    this.updateIntervalFeedback('Copied summary to the clipboard.');
  }

  handleIntervalSubmit(event) {
    event.preventDefault();

    if (!(this.interpreter instanceof FitInterpreter) || this.interpreter.messages == null) {
      this.updateIntervalFeedback('Upload a FIT file before adding intervals.', true);
      return;
    }

    const name = this.intervalNameElement.value.trim();
    const totalSeconds = Number.parseInt(this.intervalSecondsElement.value, 10);

    if (!name) {
      this.updateIntervalFeedback('Enter an interval name.', true);
      return;
    }

    if (!Number.isInteger(totalSeconds) || totalSeconds <= 0) {
      this.updateIntervalFeedback('Enter a valid time in seconds.', true);
      return;
    }

    this.interpreter.setInterval({
      name,
      totalSeconds,
    });
    this.intervalFormElement.reset();
    this.renderIntervals();
    this.renderHeartRateChart(this.currentHeartRateSeries);
    this.renderPaceChart(this.currentPaceSeries);
    this.updateIntervalFeedback(`Added interval "${name}".`, false);
    this.intervalNameElement.focus();
  }

  clearIntervals() {
    if (this.interpreter instanceof FitInterpreter) {
      this.interpreter.intervals = [];
    }

    this.intervalFormElement?.reset();
    this.renderIntervals();
    this.updateIntervalFeedback('Add intervals for the loaded activity.');
  }

  renderIntervals() {
    const intervals = this.interpreter instanceof FitInterpreter ? this.interpreter.getIntervalsSummary() : [];

    if (intervals.length === 0) {
      this.intervalListElement.innerHTML = '<p class="interval-empty">No intervals added yet.</p>';
      return;
    }

    this.intervalListElement.innerHTML = `
      <ul class="interval-items">
        ${intervals
        .map((interval) => `
            <li>
              <div class="interval-item-header">
                <strong>${interval.name}</strong>
                <strong>${this.formatSecondsDuration(interval.totalSeconds)}</strong>
              </div>
              <div class="interval-metric">
                <span>Average Heart Rate:</span>
                <strong>${interval.avgHeartRate != null ? `${Math.round(interval.avgHeartRate)} bpm` : '-'}</strong>
              </div>
              <div class="interval-metric">
                <span>Maximum Heart Rate:</span>
                <strong>${interval.maxHeartRate != null ? `${interval.maxHeartRate} bpm` : '-'}</strong>
              </div>
              <div class="interval-metric">
                <span>Average Speed:</span>
                <strong>${interval.avgEnhancedSpeed != null ? this.formatSpeed(interval.avgEnhancedSpeed) : '-'}</strong>
              </div>
              <div class="interval-metric">
                <span>Maximum Speed:</span>
                <strong>${interval.maxEnhancedSpeed != null ? this.formatSpeed(interval.maxEnhancedSpeed) : '-'}</strong>
              </div>
              <div class="interval-metric">
                <span>Average Cadence:</span>
                <strong>${interval.avgCadence != null ? `${Math.round(interval.avgCadence * 2)} spm` : '-'}</strong>
              </div>
              <div class="interval-metric">
                <span>Maximum Cadence:</span>
                <strong>${interval.maxCadence != null ? `${interval.maxCadence * 2} spm` : '-'}</strong>
              </div>
              <div class="interval-metric">
                <span>Average Step Length:</span>
                <strong>${interval.avgStepLength != null ? `${(interval.avgStepLength).toFixed(0)} mm` : '-'}</strong>
              </div>
              <div class="interval-metric">
                <span>Maximum Step Length:</span>
                <strong>${interval.maxStepLength != null ? `${(interval.maxStepLength).toFixed(0)} mm` : '-'}</strong>
              </div>
            </li>
          `)
        .join('')}
      </ul>
    `;
  }

  updateIntervalFeedback(message, isError = false) {
    this.intervalFeedbackElement.textContent = message;
    this.intervalFeedbackElement.dataset.state = isError ? 'error' : 'ready';
  }

  updateZonesFeedback(message, isError = false) {
    this.zonesFeedbackElement.textContent = message;
    this.zonesFeedbackElement.dataset.state = isError ? 'error' : 'ready';
  }

  renderSummary(summary) {
    const sections = this.buildSummarySections(summary);
    this.summaryGroupsElement.innerHTML = sections
      .filter((section) => section.items.length > 0)
      .map((section) => this.renderSummarySection(section))
      .join('');
  }

  renderSummarySection(section) {
    const items = section.items
      .map((item) => `
        <div>
          <dt>${item.label}</dt>
          <dd>${item.value}</dd>
        </div>
      `)
      .join('');

    return `
      <section class="summary-section">
        <p class="summary-heading">${section.title}</p>
        <dl class="summary-list">
          ${items}
        </dl>
      </section>
    `;
  }

  buildSummarySections(summary) {
    return [
      {
        title: 'Timing',
        items: [
          this.createSummaryItem('Start Time', summary.startTime, (value) => this.formatDateTime(value)),
          this.createSummaryItem('End Time', summary.endTime, (value) => this.formatDateTime(value)),
          this.createSummaryItem('Duration', summary.duration, (value) => this.formatDuration(value)),
        ].filter(Boolean),
      },
      {
        title: 'Activity',
        items: [
          this.createSummaryItem('Sport', summary.sport),
          this.createSummaryItem('Sub Sport', summary.subSport),
          this.createSummaryItem('Laps(km)', summary.numLaps),
          this.createSummaryItem('Calories', summary.totalCalories, (value) => `${value} kcal`),
        ].filter(Boolean),
      },
      {
        title: 'Heart Rate',
        items: [
          this.createSummaryItem('Average', summary.avgHeartRate, (value) => `${value} bpm`),
          this.createSummaryItem('Maximum', summary.maxHeartRate, (value) => `${value} bpm`),
          this.createSummaryItem('Minimum', summary.minHeartRate, (value) => `${value} bpm`),
        ].filter(Boolean),
      },
      {
        title: 'Distance & Speed',
        items: [
          this.createSummaryItem('Distance', summary.totalDistance, (value) => this.formatDistance(value)),
          this.createSummaryItem('Average Speed', summary.avgSpeed, (value) => this.formatSpeed(value)),
          this.createSummaryItem('Maximum Speed', summary.maxSpeed, (value) => this.formatSpeed(value)),
        ].filter(Boolean),
      },
      {
        title: 'Cadence',
        items: [
          this.createSummaryItem('Average Running Cadence', summary.avgRunningCadence, (value) => `${value * 2} spm`),
          this.createSummaryItem('Maximum Running Cadence', summary.maxRunningCadence, (value) => `${value * 2} spm`),
          this.createSummaryItem('Average Step Length', summary.avgStepLength, (value) => `${(value).toFixed(0)} mm`),
        ].filter(Boolean),
      },
      {
        title: 'Training',
        items: [
          this.createSummaryItem('Training Effect', summary.totalTrainingEffect),
          this.createSummaryItem('Anaerobic Effect', summary.totalAnaerobicTrainingEffect),
          this.createSummaryItem('Training Load Peak', summary.trainingLoadPeak),
        ].filter(Boolean),
      },
    ];
  }

  createSummaryItem(label, value, formatter = (currentValue) => String(currentValue)) {
    if (value == null || (typeof value === 'number' && Number.isNaN(value))) {
      return null;
    }

    return {
      label,
      value: formatter(value),
    };
  }

  formatDateTime(value) {
    if (!value) {
      return '-';
    }

    return value instanceof Date ? value.toLocaleString() : String(value);
  }

  formatDuration(duration) {
    if (duration == null) {
      return '-';
    }

    const totalSeconds = Math.floor(duration / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  formatSecondsDuration(durationInSeconds) {
    return this.formatDuration(durationInSeconds * 1000);
  }

  formatDistance(distanceInMeters) {
    if (distanceInMeters >= 1000) {
      return `${(distanceInMeters / 1000).toFixed(2)} km`;
    }

    return `${Math.round(distanceInMeters)} m`;
  }

  formatSpeed(speedInMetersPerSecond) {
    if (speedInMetersPerSecond <= 0) {
      return '-';
    }

    const secondsPerKilometer = 1000 / speedInMetersPerSecond;
    const minutes = Math.floor(secondsPerKilometer / 60);
    const seconds = Math.round(secondsPerKilometer % 60);

    if (seconds === 60) {
      return `${minutes + 1}:00 min/km`;
    }

    return `${minutes}:${String(seconds).padStart(2, '0')} min/km`;
  }

  formatPaceFromSeconds(secondsPerKilometer) {
    if (secondsPerKilometer <= 0 || Number.isNaN(secondsPerKilometer)) {
      return '-';
    }

    const roundedSeconds = Math.round(secondsPerKilometer);
    const minutes = Math.floor(roundedSeconds / 60);
    const seconds = roundedSeconds % 60;

    return `${minutes}:${String(seconds).padStart(2, '0')} min/km`;
  }
}

const app = new FitUploadApp(
  new FitDecoderService(),
  new FitInterpreter(),
);
app.initialize();
