import "react-native";

declare module "react-native" {
  interface ViewProps {
    /** macOS hover tooltip (present in react-native-macos' Flow types, missing from its .d.ts). */
    tooltip?: string;
  }
}
