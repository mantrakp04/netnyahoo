import { registerRoot } from "remotion";
import { Root } from "./Root";
import { withVideos } from "./videos/registry";

registerRoot(withVideos(Root));
