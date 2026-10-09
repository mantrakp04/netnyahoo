#include "arcadia/core/ac_fake_media.h"

#include <string>

#include "base/command_line.h"
#include "base/strings/string_util.h"
#include "chrome/browser/media/webrtc/media_capture_devices_dispatcher.h"
#include "content/public/browser/media_stream_request.h"
#include "media/base/media_switches.h"
#include "third_party/blink/public/common/mediastream/media_stream_request.h"
#include "third_party/blink/public/mojom/mediastream/media_stream.mojom.h"

namespace arcadiacore {

namespace {

// content's fake audio inputs (MediaDevicesManager's GetFakeAudioDevices); the audio service
// knows no device by these ids, so it opens Chrome's fake input stream.
constexpr char kFakeInput[] = "fake_audio_input_";

}  // namespace

bool UsingFakeMediaDevices() {
  return base::CommandLine::ForCurrentProcess()->HasSwitch(
      switches::kUseFakeDeviceForMediaStream);
}

void InstallFakeMediaDevices() {
  if (!UsingFakeMediaDevices()) {
    return;
  }
  const auto type = blink::mojom::MediaStreamType::DEVICE_AUDIO_CAPTURE;
  MediaCaptureDevicesDispatcher::GetInstance()->SetTestAudioCaptureDevices({
      blink::MediaStreamDevice(type, "fake_audio_input_1", "Fake Audio Input 1"),
      blink::MediaStreamDevice(type, "fake_audio_input_2", "Fake Audio Input 2"),
  });
}

void KeepAudioCaptureFake(content::MediaStreamRequest& request) {
  if (!UsingFakeMediaDevices() ||
      request.audio_type != blink::mojom::MediaStreamType::DEVICE_AUDIO_CAPTURE) {
    return;
  }
  // No ids (speech recognition's request must keep none): the picker's first, a fake input.
  for (const std::string& id : request.requested_audio_device_ids) {
    if (!base::StartsWith(id, kFakeInput)) {
      request.requested_audio_device_ids = {std::string(kFakeInput) + "1"};
      return;
    }
  }
}

}  // namespace arcadiacore
