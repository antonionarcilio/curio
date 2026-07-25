import request from 'supertest';

const mockEditVideoCaption = jest.fn();
const mockDeleteVideoMessage = jest.fn();

jest.mock('@/telegram-client', () => ({
  editVideoCaption: mockEditVideoCaption,
  deleteVideoMessage: mockDeleteVideoMessage,
}));

import deleteVideoRouter from '@/routes/video/delete/route';
import updateVideoRouter from '@/routes/video/update/route';
import { mountRouter } from '@test/helpers/mount-router';

const buildApp = () => mountRouter([updateVideoRouter, deleteVideoRouter], { json: true });

describe('PATCH /video/update/:chatId/:messageId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('edits the caption and returns edited: true', async () => {
    mockEditVideoCaption.mockResolvedValue(undefined);

    const res = await request(buildApp()).patch('/video/update/chat1/10').send({ description: 'nova descrição' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ edited: true, chat_id: 'chat1', message_id: '10' });
    expect(mockEditVideoCaption).toHaveBeenCalledWith('chat1', '10', 'nova descrição');
  });

  it('returns 400 when description is missing', async () => {
    const res = await request(buildApp()).patch('/video/update/chat1/10').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(mockEditVideoCaption).not.toHaveBeenCalled();
  });

  it('returns 400 when description is an empty string', async () => {
    const res = await request(buildApp()).patch('/video/update/chat1/10').send({ description: '   ' });

    expect(res.status).toBe(400);
    expect(mockEditVideoCaption).not.toHaveBeenCalled();
  });

  it('returns 404 with the error message when editVideoCaption rejects', async () => {
    mockEditVideoCaption.mockRejectedValue(new Error('Mensagem não encontrada'));

    const res = await request(buildApp()).patch('/video/update/chat1/10').send({ description: 'nova descrição' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Mensagem não encontrada' });
  });
});

describe('DELETE /video/delete/:chatId/:messageId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deletes the message and returns deleted: true', async () => {
    mockDeleteVideoMessage.mockResolvedValue(undefined);

    const res = await request(buildApp()).delete('/video/delete/chat1/10');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true, chat_id: 'chat1', message_id: '10' });
    expect(mockDeleteVideoMessage).toHaveBeenCalledWith('chat1', '10');
  });

  it('returns 404 with the error message when deleteVideoMessage rejects', async () => {
    mockDeleteVideoMessage.mockRejectedValue(new Error('Mensagem não encontrada'));

    const res = await request(buildApp()).delete('/video/delete/chat1/10');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Mensagem não encontrada' });
  });
});
