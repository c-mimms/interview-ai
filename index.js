const { spawn, exec } = require('child_process');
const fs = require('fs');
const record = require('node-record-lpcm16');
const axios = require('axios');
const queryGpt = require('./gpt.js').queryGpt;

const devices = ["BlackHole 16ch","default"];

class AudioRecorder {
    constructor(device) {
        console.log(device);
        this.device = device;
        this.fileName = "audio";
        this.fileNum = 0;
        this.file = null;
        this.recording = null;
        this.audioStream = null;
        this.ffmpeg = spawn('ffmpeg', ['-i', '-', '-af', 'silencedetect=n=-30dB:d=1', '-f', 'null', '-']);
    }

    init() {
        this.ffmpeg.stderr.on('data', this.handleFFmpegOutput.bind(this));
        this.ffmpeg.on('close', this.handleFFmpegClose.bind(this));
        this.detectRecording = record.record({
            sampleRate: 20000,
            device: this.device
        }).stream().pipe(this.ffmpeg.stdin);
        this.startRecording();
    }

    startRecording() {
        this.fileNum++;
        console.log(`Started new recording ${this.fileName}${this.fileNum}_${this.device}.wav`);
        this.file = fs.createWriteStream(`${this.fileName}${this.fileNum}_${this.device}.wav`, { encoding: 'binary' });
        this.recording = record.record({
            sampleRate: 20000,
            verbose: true,
            device: this.device
        });
        this.audioStream = this.recording.stream();
        this.audioStream.pipe(this.file);
    }

    stopRecording() {
        this.audioStream.unpipe(this.file);
        this.audioStream.end();
        this.file.end();
        this.recording.stop();
    }

    async onSilenceDetected() {
        this.stopRecording();
        this.startRecording();
        transcribeAudio(this.device, `${this.fileName}${this.fileNum-1}_${this.device}.wav`);
    }

    handleFFmpegOutput(data) {
        // console.log(`Output : ${data}`);
        const lines = data.toString().split('\n');
        for (const line of lines) {
            if (line.includes('silence_start')) {
                this.onSilenceDetected();
                break;
            }
        }
    }

    handleFFmpegClose(code) {
        console.log(`ffmpeg process exited with code ${code}`);
    }
}

async function evaluateCommand(command) {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`exec error: ${ error }`);
                reject(error);
            } else {
                resolve(stdout.trim());
            }
        });
    });
}

function stripBrackets(line) {
    return line.toString().replace(/\[.*\]/g, '').replace(/\n/g, ' ');
}

async function transcribeAudio(device, filename) {
    const command = `whisper "${filename}" --model tiny.en --language English --fp16 False --output_dir ./trash`;
    const transcription = await evaluateCommand(command);
    const stripped = stripBrackets(transcription);
    console.log(`${device} :  ${stripped}`);
    storeMessage(device, stripped);
}

function storeMessage(device, message) {
    if(device == "BlackHole 16ch"){
        // Send the message to ChatGPT API
        var interviewerMessage = { 'role': 'user', 'name': 'Interviewer','content': message };
        messageHistory.push(interviewerMessage);
        // sendToChatGPT();
    } else {
        var interviewerMessage = { 'role': 'user', 'name': 'Chris', 'content': message };
        messageHistory.push(interviewerMessage);
    }
}

async function sendToChatGPT() {
    var response = await queryGpt([systemMsg].concat(messageHistory));
    console.log(response);
}

const current_date = new Date().toLocaleString();
const systemMsg = { 'role': 'system', 'content': `You are InterviewBot. Your primary directive is to output whatever you think would be most helpful to Chris, who is currently interviewing for a Senior Software engineering position at Square. Respond as briefly as possible. Current date: ${current_date}` };
var messageHistory = [];

function main() {
    devices.forEach(device => {
        var devRec = new AudioRecorder(device);
        devRec.init();
    });
}

main();

