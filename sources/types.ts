import { GitHubProfile } from "./app/types";

export type AccountProfile = {
    firstName: string | null;
    lastName: string | null;
    github: GitHubProfile | null;
    settings: {
        value: string | null;
        version: number;
    } | null;
}