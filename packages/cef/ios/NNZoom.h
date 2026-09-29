#pragma once

#import "NNCefInternal.h"

namespace nn {
class Client;
}

namespace nn::zoom {

inline double FactorForLevel(double level) { return pow(1.2, level); }
inline double LevelForFactor(double factor) { return log(factor) / log(1.2); }

void Changed(NSString *profile, NSString *host);
void Committed(Client *client);
void InstallScrollMonitor();

// ⌘-scroll zooms with a wheel mouse or a Magic Mouse and scrolls with a trackpad. A gesture's
// device is settled when it begins and holds through its momentum.
struct ScrollGesture {
  bool trackpad = false;
};
struct ScrollStep {
  NSEventPhase phase;
  NSEventPhase momentumPhase;
  bool command;
  bool trackpad;
};
bool CommandScrollZooms(ScrollGesture &gesture, ScrollStep step);

}
