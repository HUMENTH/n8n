import { describe, expect, it, vi } from 'vitest';

import type { EngineLogger } from '../../logging';
import { ExecutionResponseSender } from '../execution-response-sender';
import type { ExecutionResponse } from '../execution-response.types';
import type { ResponseFrameSender } from '../response-frame';

const silentLogger = (): EngineLogger => ({
	error: vi.fn(),
	warn: vi.fn(),
	info: vi.fn(),
	debug: vi.fn(),
});

const ended = (outputs: unknown): ExecutionResponse => ({
	type: 'ended',
	executionId: 'exec-1',
	workflowId: 'wf-1',
	status: 'completed',
	lastStep: { nodeId: 'a', nodeName: 'A', status: 'completed', outputs: outputs as never },
});

describe('ExecutionResponseSender', () => {
	it('serializes a response before sending it', () => {
		const frameSender: ResponseFrameSender = { send: vi.fn(), stop: vi.fn() };
		const sender = new ExecutionResponseSender(frameSender);

		sender.send(ended([[{ at: new Date(0) }]]));

		expect(frameSender.send).toHaveBeenCalledExactlyOnceWith(
			'exec-1',
			JSON.stringify(ended([[{ at: '1970-01-01T00:00:00.000Z' }]])),
		);
	});

	it('reports a response that exceeds the frame size limit', () => {
		const frameSender: ResponseFrameSender = { send: vi.fn(), stop: vi.fn() };
		const sender = new ExecutionResponseSender(frameSender, silentLogger(), 256);

		sender.send(ended([['x'.repeat(500)]]));

		expect(frameSender.send).toHaveBeenCalledExactlyOnceWith(
			'exec-1',
			JSON.stringify({
				type: 'failure',
				executionId: 'exec-1',
				error: {
					code: 'RESPONSE_TOO_LARGE',
					message: 'The execution response exceeds the maximum size of 256 bytes.',
				},
			}),
		);
	});

	it('reports a response that cannot be serialized', () => {
		const frameSender: ResponseFrameSender = { send: vi.fn(), stop: vi.fn() };
		const sender = new ExecutionResponseSender(frameSender, silentLogger());
		const response = ended(null) as ExecutionResponse & { circular?: unknown };
		response.circular = response;

		sender.send(response);

		expect(frameSender.send).toHaveBeenCalledExactlyOnceWith(
			'exec-1',
			JSON.stringify({
				type: 'failure',
				executionId: 'exec-1',
				error: {
					code: 'RESPONSE_SERIALIZATION_FAILED',
					message: 'The execution response could not be serialized.',
				},
			}),
		);
	});

	it('stamps the execution id, so a step carries no routing state', () => {
		const frameSender: ResponseFrameSender = { send: vi.fn(), stop: vi.fn() };
		const sender = new ExecutionResponseSender(frameSender);

		sender.emitterFor('exec-1').send({ ok: true });

		expect(frameSender.send).toHaveBeenCalledExactlyOnceWith(
			'exec-1',
			JSON.stringify({ type: 'response', executionId: 'exec-1', payload: { ok: true } }),
		);
	});

	it('stops its frame sender', async () => {
		const frameSender: ResponseFrameSender = { send: vi.fn(), stop: vi.fn() };
		const sender = new ExecutionResponseSender(frameSender);

		await sender.stop();

		expect(frameSender.stop).toHaveBeenCalledOnce();
	});
});
