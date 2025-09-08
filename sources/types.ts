export type AccountProfile = {
    firstName: string | null;
    lastName: string | null;
    settings: {
        value: string | null;
        version: number;
    } | null;
}