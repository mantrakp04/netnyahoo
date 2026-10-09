import { Film, meta as metaFor } from "../../lib/ac-launch/Film";
import document from "./studio.json";

export const meta = metaFor("launch", 1920, 1080);

export default function Video() {
  return <Film cut="launch" document={document} />;
}
