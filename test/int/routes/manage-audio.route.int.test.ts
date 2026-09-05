import request from 'supertest';

const mockEditAudioCaption = jest.fn();
const mockDeleteAudioMessage = jest.fn();

jest.mock('@/telegram-client', () => ({
  editMessageCaption: mockEditAudioCaption,
  deleteMessage: mockDeleteAudioMessage,
}));

import deleteAudioRouter from '@/routes/audio/delete/route';
import updateAudioRouter from '@/routes/audio/update/route';
import { mountRouter } from '@test/helpers/mount-router';

const buildApp = () => mountRouter([updateAudioRouter, deleteAudioRouter], { json: true });

describe('PATCH /audio/update/:chatId/:messageId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('edits the caption and returns edited: true', async () => {
    mockEditAudioCaption.mockResolvedValue(undefined);

    const res = await request(buildApp()).patch('/audio/update/chat1/10').send({ description: 'nova descrição' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ edited: true, chat_id: 'chat1', message_id: '10' });
    expect(mockEditAudioCaption).toHaveBeenCalledWith('chat1', '10', 'nova descrição');
  });

  it('returns 400 when description is missing', async () => {
    const res = await request(buildApp()).patch('/audio/update/chat1/10').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(mockEditAudioCaption).not.toHaveBeenCalled();
  });

  it('returns 404 with the error message when editMessageCaption rejects', async () => {
    mockEditAudioCaption.mockRejectedValue(new Error('Mensagem não encontrada'));

    const res = await request(buildApp()).patch('/audio/update/chat1/10').send({ description: 'nova descrição' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Mensagem não encontrada' });
  });
});

describe('DELETE /audio/delete/:chatId/:messageId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deletes the message and returns deleted: true', async () => {
    mockDeleteAudioMessage.mockResolvedValue(undefined);

    const res = await request(buildApp()).delete('/audio/delete/chat1/10');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true, chat_id: 'chat1', message_id: '10' });
    expect(mockDeleteAudioMessage).toHaveBeenCalledWith('chat1', '10');
  });

  it('returns 404 with the error message when deleteMessage rejects', async () => {
    mockDeleteAudioMessage.mockRejectedValue(new Error('Mensagem não encontrada'));

    const res = await request(buildApp()).delete('/audio/delete/chat1/10');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Mensagem não encontrada' });
  });
});
