import { toResult } from '@n8n/utils/result';

import { createConsoleLogger, type EngineLogger } from '../logging';
import type { ExecutionResponse, FailureMessage } from './execution-response.types';
import type { ResponseFrameSender } from './response-frame';

/** A frame sender must be able to carry every frame this class produces. */
const MAX_FRAME_BYTES = 5 * 1024 * 1024;

/** Sends responses from an execution back to its caller, guarding against frames a transport cannot carry. */
export class ExecutionResponseSender {
	constructor(
		private readonly frameSender: ResponseFrameSender,
		private readonly logger: EngineLogger = createConsoleLogger(),
		private readonly maxFrameBytes: number = MAX_FRAME_BYTES,
	) {}

	send(response: ExecutionResponse): void {
		this.frameSender.send(response.executionId, this.toFrame(response));
	}

	async stop(): Promise<void> {
		await this.frameSender.stop();
	}

	private toFrame(response: ExecutionResponse): string {
		const serialized = toResult(() => JSON.stringify(response));
		if (!serialized.ok) {
			this.logger.warn('Could not serialize an execution response', {
				executionId: response.executionId,
				type: response.type,
				error: serialized.error,
			});
			return this.failureFrame(response.executionId, {
				code: 'RESPONSE_SERIALIZATION_FAILED',
				message: 'The execution response could not be serialized.',
			});
		}

		if (Buffer.byteLength(serialized.result) > this.maxFrameBytes) {
			this.logger.warn('Execution response exceeds the frame size limit', {
				executionId: response.executionId,
				type: response.type,
			});
			return this.failureFrame(response.executionId, {
				code: 'RESPONSE_TOO_LARGE',
				message: `The execution response exceeds the maximum size of ${this.maxFrameBytes} bytes.`,
			});
		}

		return serialized.result;
	}

	private failureFrame(executionId: string, error: FailureMessage['error']): string {
		return JSON.stringify({ type: 'failure', executionId, error } satisfies FailureMessage);
	}
}
