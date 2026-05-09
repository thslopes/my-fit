import { Decoder, Stream } from '@garmin/fitsdk';
import './style.css';

class FitInterpreter {
  getSummary(messages) {
    let startTime = null;
    let endTime = null;
    let summary = null;

    for (const message of messages) {
      if (message.event === 'timer' && message.eventType === 'start') {
        startTime = message.timestamp;
      }
      if (message.event === 'timer' && message.eventType === 'stopAll') {
        endTime = message.timestamp;
      }
      if (message.avgSpeed != null){
        summary = message;
      }
    }

    return { startTime, endTime, duration: startTime && endTime ? (endTime - startTime) : null, ...summary };
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
  }

  initialize() {
    this.statusElement = document.querySelector('[data-role="status"]');
    this.messageCountElement = document.querySelector('[data-role="message-count"]');
    this.fileNameElement = document.querySelector('[data-role="file-name"]');

    const fileInput = document.querySelector('#fit-file');
    fileInput.addEventListener('change', (event) => {
      this.handleFileSelection(event).catch((error) => {
        this.showResults();
        this.updateStatus(error.message, true);
        this.messageCountElement.textContent = '-';
        this.clearSummary();
      });
    });
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

    const summary = this.interpreter.getSummary(messages);

    this.messageCountElement.textContent = String(messages.length);
    this.renderSummary(summary);
    this.updateStatus('Decoded successfully.');
  }

  reset() {
    this.resultsElement.hidden = true;
    this.fileNameElement.textContent = 'No file selected';
    this.messageCountElement.textContent = '-';
    this.clearSummary();
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
          this.createSummaryItem('Elapsed Time', summary.totalElapsedTime, (value) => this.formatSecondsDuration(value)),
          this.createSummaryItem('Timer Time', summary.totalTimerTime, (value) => this.formatSecondsDuration(value)),
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
    if (value == null) {
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
