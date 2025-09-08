// Single-user mode: Encryption disabled - all functions are no-ops

export async function initEncrypt() {
    // No-op in single-user mode
}

export function encryptString(path: string[], string: string): string {
    // No encryption in single-user mode, return as-is
    return string;
}

export function encryptBytes(path: string[], bytes: Uint8Array): Uint8Array {
    // No encryption in single-user mode, return as-is  
    return bytes;
}

export function decryptString(path: string[], encrypted: Uint8Array): string {
    // No decryption needed in single-user mode, treat as plain text
    return new TextDecoder().decode(encrypted);
}

export function decryptBytes(path: string[], encrypted: Uint8Array): Uint8Array {
    // No decryption needed in single-user mode, return as-is
    return encrypted;
}