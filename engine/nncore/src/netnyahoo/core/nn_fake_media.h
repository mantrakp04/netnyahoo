// Test runs only (--use-fake-device-for-media-stream, which every hidden test instance gets):
// capture stays on Chrome's fake devices end to end. The switch alone fakes the camera and the
// device list, but the list's "default" microphone is the Mac's real default input to the audio
// service: a stream on it makes CoreAudio open the real microphone, and macOS asks the owner
// for consent. So a test instance's microphone is always Chrome's fake input.

#ifndef NETNYAHOO_CORE_NN_FAKE_MEDIA_H_
#define NETNYAHOO_CORE_NN_FAKE_MEDIA_H_

namespace content {
struct MediaStreamRequest;
}

namespace nncore {

// Whether this run captures from fake devices only.
bool UsingFakeMediaDevices();

// Once the browser process is up: Chrome's device picker offers the fake inputs only, so a
// request nothing rewrote (a tab of Chrome's own windows) gets no microphone, never the Mac's.
void InstallFakeMediaDevices();

// A tab's microphone request that names any other input ("default" is the real one) names the
// first fake input instead.
void KeepAudioCaptureFake(content::MediaStreamRequest& request);

}  // namespace nncore

#endif  // NETNYAHOO_CORE_NN_FAKE_MEDIA_H_
