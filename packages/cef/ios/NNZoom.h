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

}
