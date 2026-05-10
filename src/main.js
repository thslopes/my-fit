import { Decoder, Stream } from '@garmin/fitsdk';
import './style.css';

class FitInterpreter {
  constructor(messages) {
    this.messages = messages;
    console.log('Messages:', messages);
    this.intervals = [];
  }

  getSummary() {
    let startTime = null;
    let endTime = null;
    let summary = null;

    for (const message of this.messages) {
      if (message.event === 'timer' && message.eventType === 'start') {
        startTime = message.timestamp;
      }
      if (message.event === 'timer' && message.eventType === 'stopAll') {
        endTime = message.timestamp;
      }
      if (message.avgSpeed != null) {
        summary = message;
      }
    }

    return { startTime, endTime, duration: startTime && endTime ? (endTime - startTime) : null, ...summary };
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

    let sumEnhancedSpeed = 0;
    let maxEnhancedSpeed = 0;

    let sumCadence = 0;
    let maxCadence = 0;

    let sumStepLength = 0;
    let maxStepLength = 0;

    for (const message of this.messages) {
      if (message.heartRate != null) {
        recordCount++;
        sumHeartRate += message.heartRate;
        maxHeartRate = Math.max(maxHeartRate, message.heartRate);
      }

      if (message.enhancedSpeed != null) {
        sumEnhancedSpeed += message.enhancedSpeed;
        maxEnhancedSpeed = Math.max(maxEnhancedSpeed, message.enhancedSpeed);
      }

      if (message.cadence != null) {
        sumCadence += message.cadence;
        maxCadence = Math.max(maxCadence, message.cadence);
      }

      if (message.stepLength != null) {
        sumStepLength += message.stepLength;
        maxStepLength = Math.max(maxStepLength, message.stepLength);
      }

      if (recordCount > intervalFinalSecond) {
        let currentInterval = this.intervals[currentIntervalIndex];
        currentInterval.avgHeartRate = sumHeartRate / currentInterval.totalSeconds;
        currentInterval.maxHeartRate = maxHeartRate;

        currentInterval.avgEnhancedSpeed = sumEnhancedSpeed / currentInterval.totalSeconds;
        currentInterval.maxEnhancedSpeed = maxEnhancedSpeed;

        currentInterval.avgCadence = sumCadence / currentInterval.totalSeconds;
        currentInterval.maxCadence = maxCadence;

        currentInterval.avgStepLength = sumStepLength / currentInterval.totalSeconds;
        currentInterval.maxStepLength = maxStepLength;

        sumHeartRate = 0;
        maxHeartRate = 0;
        sumEnhancedSpeed = 0;
        maxEnhancedSpeed = 0;
        sumCadence = 0;
        maxCadence = 0;
        sumStepLength = 0;
        maxStepLength = 0;

        currentIntervalIndex++;
        if (currentIntervalIndex == this.intervals.length) {
          break;
        }
        intervalFinalSecond += this.intervals[currentIntervalIndex].totalSeconds;
      }
    }

    if (maxHeartRate > 0) {
      let currentInterval = this.intervals[currentIntervalIndex];
      let totalSeconds = recordCount;
      for (let i=0; i<this.intervals.length-1; i++) {
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
}

class FitDecoderService {
  getMessages(arrayBuffer) {
    const stream = Stream.fromArrayBuffer(arrayBuffer);
    const decoder = new Decoder(stream);

    if (!decoder.isFIT()) {
      throw new Error('The selected file is not a valid FIT file.');
    }

    const { messages, errors } = decoder.read();

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

    this.copySummaryButtonElement.addEventListener('click', () => {
      this.handleCopySummary().catch((e) => {
        this.updateIntervalFeedback('Unable to copy the summary to the clipboard.', true);
        console.error('Clipboard copy failed:', e);
      });
    });

    this.renderIntervals();
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
    this.clearIntervals();

    this.messageCountElement.textContent = String(messages.length);
    this.renderSummary(summary);
    this.updateStatus('Decoded successfully.');
  }

  reset() {
    this.resultsElement.hidden = true;
    this.fileNameElement.textContent = 'No file selected';
    this.messageCountElement.textContent = '-';
    this.clearSummary();
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
              <strong>${interval.name}</strong>
              <strong>${this.formatSecondsDuration(interval.totalSeconds)}</strong>
               -
              <span>Average Heart Rate</span>
              <strong>${interval.avgHeartRate != null ? `${Math.round(interval.avgHeartRate)} bpm` : '-'}</strong>
               -
              <span>Maximum Heart Rate</span>
              <strong>${interval.maxHeartRate != null ? `${interval.maxHeartRate} bpm` : '-'}</strong>
                -
              <span>Average Speed</span>
              <strong>${interval.avgEnhancedSpeed != null ? this.formatSpeed(interval.avgEnhancedSpeed) : '-'}</strong>
                -
              <span>Maximum Speed</span>
              <strong>${interval.maxEnhancedSpeed != null ? this.formatSpeed(interval.maxEnhancedSpeed) : '-'}</strong>
                -
              <span>Average Cadence</span>
              <strong>${interval.avgCadence != null ? `${Math.round(interval.avgCadence * 2)} spm` : '-'}</strong>
                -
              <span>Maximum Cadence</span>
              <strong>${interval.maxCadence != null ? `${interval.maxCadence * 2} spm` : '-'}</strong>
                -
              <span>Average Step Length</span>
              <strong>${interval.avgStepLength != null ? `${(interval.avgStepLength).toFixed(0)} mm` : '-'}</strong>
                -
              <span>Maximum Step Length</span>
              <strong>${interval.maxStepLength != null ? `${(interval.maxStepLength).toFixed(0)} mm` : '-'}</strong>
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
}

const app = new FitUploadApp(
  new FitDecoderService(),
  new FitInterpreter(),
);
app.initialize();
