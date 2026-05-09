import { Decoder, Stream } from '@garmin/fitsdk';
import './style.css';

class FitDecoderService {
    countMessages(arrayBuffer) {
        const stream = Stream.fromArrayBuffer(arrayBuffer);
        const decoder = new Decoder(stream);

        if (!decoder.isFIT()) {
            throw new Error('The selected file is not a valid FIT file.');
        }

        const { messages, errors } = decoder.read();

        if (errors.length > 0) {
            throw new Error(errors[0].message ?? 'The FIT file could not be decoded.');
        }

        return Object.values(messages).reduce((count, group) => count + group.length, 0);
    }
}

class FitUploadApp {
    constructor(rootElement, decoderService) {
        this.rootElement = rootElement;
        this.decoderService = decoderService;
        this.statusElement = null;
        this.messageCountElement = null;
        this.fileNameElement = null;
    }

    render() {
        this.rootElement.innerHTML = `
      <main class="shell">
        <section class="card">
          <p class="eyebrow">Garmin FIT Parser</p>
          <h1>Count messages in a .fit file</h1>
          <p class="lede">
            Upload a FIT activity file and this page will decode it locally in your browser.
          </p>
          <label class="upload-zone" for="fit-file">
            <span class="upload-title">Choose a FIT file</span>
            <span class="upload-copy">Tap to browse or replace the selected file.</span>
          </label>
          <input id="fit-file" class="file-input" type="file" accept=".fit,application/octet-stream" />
          <dl class="results" aria-live="polite">
            <div>
              <dt>File</dt>
              <dd data-role="file-name">No file selected</dd>
            </div>
            <div>
              <dt>Messages</dt>
              <dd data-role="message-count">-</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd data-role="status">Waiting for upload</dd>
            </div>
          </dl>
        </section>
      </main>
    `;

        this.statusElement = this.rootElement.querySelector('[data-role="status"]');
        this.messageCountElement = this.rootElement.querySelector('[data-role="message-count"]');
        this.fileNameElement = this.rootElement.querySelector('[data-role="file-name"]');

        const fileInput = this.rootElement.querySelector('#fit-file');
        fileInput.addEventListener('change', (event) => {
            this.handleFileSelection(event).catch((error) => {
                this.updateStatus(error.message, true);
                this.messageCountElement.textContent = '-';
            });
        });
    }

    async handleFileSelection(event) {
        const [file] = event.target.files;

        if (!file) {
            this.reset();
            return;
        }

        this.fileNameElement.textContent = file.name;
        this.messageCountElement.textContent = '...';
        this.updateStatus('Reading file...');

        const buffer = await file.arrayBuffer();
        const messageCount = this.decoderService.countMessages(buffer);

        this.messageCountElement.textContent = String(messageCount);
        this.updateStatus('Decoded successfully.');
    }

    reset() {
        this.fileNameElement.textContent = 'No file selected';
        this.messageCountElement.textContent = '-';
        this.updateStatus('Waiting for upload');
    }

    updateStatus(message, isError = false) {
        this.statusElement.textContent = message;
        this.statusElement.dataset.state = isError ? 'error' : 'ready';
    }
}

const rootElement = document.querySelector('#app');
const app = new FitUploadApp(rootElement, new FitDecoderService());
app.render();