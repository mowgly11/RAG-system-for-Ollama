import type { Failure, FunctionResponse, Success } from "../types/types";

/**
 * Builds the project's result object. Overloaded so that a success carries a
 * typed payload and a failure carries none, which lets callers narrow on `ok`.
 */
function returnCreator<T>(error: null, data: T): Success<T>;
function returnCreator(error: string, data?: null): Failure;
function returnCreator<T>(error: string | null, data: T | null = null): FunctionResponse<T> {
    if (error === null) return { ok: true, error: null, data: data as T };

    return { ok: false, error, data: null };
}

export default returnCreator;
