import { Component, type ReactNode } from "react";
import { ScrollView, Text } from "react-native";

/** Dev-only: shows render errors in place instead of an empty window. */
export class DevErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    (globalThis as { __lastRenderError?: string }).__lastRenderError = `${error.message}\n${error.stack ?? ""}`;
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <ScrollView style={{ flex: 1, backgroundColor: "#1b1416", padding: 24 }}>
        <Text style={{ color: "#ff8a8a", fontSize: 14, fontFamily: "Menlo" }}>
          {this.state.error.message}
          {"\n\n"}
          {this.state.error.stack}
        </Text>
      </ScrollView>
    );
  }
}
