import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatController } from './chat.controller';

function makeController() {
  const prisma: any = {
    venue: {
      findUnique: vi.fn().mockResolvedValue({ timezone: 'UTC' }),
    },
    profile: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    scheduleShift: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    shiftSwap: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    conversation: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'conv-created' }),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockReturnValue('conversation-delete'),
    },
    conversationRead: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
    },
    message: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'msg-created' }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockReturnValue('message-delete-many'),
    },
    chatImage: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'img-created' }),
    },
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi.fn().mockResolvedValue([{ key: 'lease:chat-context:venue-1' }]),
  };
  prisma.$transaction = vi.fn((operation: any) => (
    typeof operation === 'function' ? operation(prisma) : Promise.all(operation)
  ));

  const mediaAccess = {
    createPath: vi.fn().mockImplementation((_kind: string, _id: string, _venueId: string, path: string) => `signed:${path}`),
    assertToken: vi.fn(),
  } as any;

  const s3ImageService = {
    upload: vi.fn().mockResolvedValue('uploads/chat-image.webp'),
    delete: vi.fn().mockResolvedValue(undefined),
    getPresignedUrl: vi.fn().mockResolvedValue('https://signed.example/image.webp'),
  } as any;

  const controller = new ChatController(prisma, mediaAccess, s3ImageService);
  return { controller, prisma, mediaAccess, s3ImageService };
}

const managerScope = {
  venueId: 'venue-1',
  profileId: 'manager-1',
  role: 'manager',
  allAccess: false,
} as any;

const staffScope = {
  venueId: 'venue-1',
  profileId: 'staff-1',
  role: 'staff',
  allAccess: false,
} as any;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ChatController', () => {
  it('creates missing contextual role conversations', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));

    const { controller, prisma } = makeController();
    prisma.profile.findMany.mockResolvedValue([
      { id: 'manager-1', jobTitle: 'Manager', role: 'manager', allAccess: false },
      { id: 'server-1', jobTitle: 'Server', role: 'staff', allAccess: false },
      { id: 'server-2', jobTitle: 'Server', role: 'staff', allAccess: false },
      { id: 'bar-1', jobTitle: 'Bartender', role: 'staff', allAccess: false },
    ]);
    prisma.conversation.findMany.mockResolvedValue([]);

    await controller.ensureContextualConversations('venue-1');

    expect(prisma.conversation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        venueId: 'venue-1',
        type: 'role',
        roleName: 'Server',
        name: '#Role - Server',
        memberIds: ['manager-1', 'server-1', 'server-2'],
        isSystem: true,
      }),
    }));
    expect(prisma.conversation.create).toHaveBeenCalledTimes(3);
  });


  it('returns dm messages, read receipts, and signed image paths', async () => {
    const { controller, prisma, mediaAccess } = makeController();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      venueId: 'venue-1',
      type: 'dm',
      name: null,
      memberIds: ['staff-1', 'staff-2'],
    });
    prisma.profile.findMany.mockResolvedValue([
      { id: 'staff-1', fullName: 'Alex Agent' },
      { id: 'staff-2', fullName: 'Jamie Jones' },
    ]);
    prisma.conversationRead.findMany.mockResolvedValue([
      { profileId: 'staff-1', readAt: new Date('2026-07-15T10:00:00Z') },
      { profileId: 'staff-2', readAt: new Date('2026-07-15T10:05:00Z') },
    ]);
    prisma.message.findMany.mockResolvedValue([
      {
        id: 'msg-2',
        text: 'Newest',
        senderId: null,
        createdAt: new Date('2026-07-15T10:02:00Z'),
        imageUrl: null,
        reactions: null,
      },
      {
        id: 'msg-1',
        text: 'Photo',
        senderId: 'staff-2',
        createdAt: new Date('2026-07-15T10:01:00Z'),
        imageUrl: '/v1/chat/images/img-1',
        reactions: { fire: ['staff-2'] },
      },
    ]);

    const result = await controller.getMessages(staffScope, 'conv-1');

    expect(result.title).toBe('Jamie Jones');
    expect(result.readReceipts).toEqual([{ name: 'Jamie Jones', readAt: new Date('2026-07-15T10:05:00Z').getTime() }]);
    expect(result.messages).toEqual([
      expect.objectContaining({
        id: 'msg-1',
        senderName: 'Jamie Jones',
        mine: false,
        imageUrl: 'signed:/v1/chat/images/img-1',
        reactions: { fire: ['staff-2'] },
      }),
      expect.objectContaining({
        id: 'msg-2',
        senderName: 'Former teammate',
        mine: false,
        imageUrl: null,
        reactions: {},
      }),
    ]);
    expect(prisma.conversationRead.upsert).toHaveBeenCalled();
    expect(prisma.message.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }));
    expect(mediaAccess.createPath).toHaveBeenCalledWith('chat-image', 'img-1', 'venue-1', '/v1/chat/images/img-1');
  });
  it('updates contextual conversations when membership or naming drifts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));

    const { controller, prisma } = makeController();
    prisma.profile.findMany.mockResolvedValue([
      { id: 'staff-1', jobTitle: 'Server', role: 'staff', allAccess: false },
      { id: 'staff-2', jobTitle: 'Server', role: 'staff', allAccess: false },
    ]);
    prisma.scheduleShift.findMany.mockResolvedValue([{ profileId: 'staff-1', dayIndex: 3 }]);
    prisma.conversation.findMany.mockResolvedValue([
      { id: 'role-server', venueId: 'venue-1', type: 'role', roleName: 'Server', name: '#Role - Old', memberIds: ['staff-1'] },
      { id: 'shift-day', venueId: 'venue-1', type: 'shift', shiftDate: '2026-07-15', name: '#Crew - Old', memberIds: [] },
    ]);

    await controller.ensureContextualConversations('venue-1');

    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'role-server' },
      data: { memberIds: ['staff-1', 'staff-2'], name: '#Role - Server', isSystem: true },
    });
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });
  it('allows only one replica to run a contextual sync during the shared lease', async () => {
    const first = makeController();
    const second = makeController();
    second.prisma.$queryRaw.mockResolvedValue([]);
    const firstSync = vi.spyOn(first.controller, 'ensureContextualConversations').mockResolvedValue(undefined);
    const secondSync = vi.spyOn(second.controller, 'ensureContextualConversations').mockResolvedValue(undefined);

    await Promise.all([
      first.controller.listConversations(staffScope),
      second.controller.listConversations(staffScope),
    ]);

    expect(firstSync).toHaveBeenCalledOnce();
    expect(secondSync).not.toHaveBeenCalled();
  });

  it('lists filtered conversations with dm titles and unread state', async () => {
    const { controller, prisma } = makeController();
    vi.spyOn(controller, 'ensureContextualConversations').mockResolvedValue(undefined);

    const recent = new Date('2026-07-15T11:00:00Z');
    const old = new Date('2026-07-15T10:00:00Z');

    prisma.conversation.findMany.mockResolvedValue([
      { id: 'group-1', venueId: 'venue-1', type: 'group', name: 'Closing Crew', memberIds: ['staff-1'], lastMessageText: 'Wrap up', lastMessageAt: recent },
      { id: 'group-2', venueId: 'venue-1', type: 'group', name: 'Hidden', memberIds: ['staff-2'], lastMessageText: 'Private', lastMessageAt: recent },
      { id: 'role-1', venueId: 'venue-1', type: 'role', name: '#Role - Server', memberIds: ['staff-1'], lastMessageText: 'Prep', lastMessageAt: old },
      { id: 'shift-1', venueId: 'venue-1', type: 'shift', name: '#Crew - Wednesday', memberIds: ['staff-1'], lastMessageText: 'Open', lastMessageAt: old },
      { id: 'dm-1', venueId: 'venue-1', type: 'dm', name: null, memberIds: ['staff-1', 'staff-2'], lastMessageText: 'Hey', lastMessageAt: recent },
      { id: 'dm-2', venueId: 'venue-1', type: 'dm', name: null, memberIds: ['staff-2', 'staff-3'], lastMessageText: 'Nope', lastMessageAt: recent },
    ]);
    prisma.profile.findMany.mockResolvedValue([
      { id: 'staff-1', fullName: 'Alex Agent' },
      { id: 'staff-2', fullName: 'Jamie Jones' },
    ]);
    prisma.conversationRead.findMany.mockResolvedValue([
      { conversationId: 'group-1', readAt: old, profileId: 'staff-1' },
      { conversationId: 'role-1', readAt: recent, profileId: 'staff-1' },
      { conversationId: 'dm-1', readAt: old, profileId: 'staff-1' },
    ]);

    const result = await controller.listConversations(staffScope);

    expect(result.groups).toEqual([
      expect.objectContaining({ id: 'group-1', title: 'Closing Crew', unread: true }),
    ]);
    expect(result.roles).toEqual([
      expect.objectContaining({ id: 'role-1', title: '#Role - Server', unread: false }),
    ]);
    expect(result.shifts).toEqual([
      expect.objectContaining({ id: 'shift-1', title: '#Crew - Wednesday', unread: true }),
    ]);
    expect(result.dms).toEqual([
      expect.objectContaining({ id: 'dm-1', title: 'Jamie Jones', unread: true }),
    ]);
  });

  it('lists the teammate directory for the active venue', async () => {
    const { controller, prisma } = makeController();
    prisma.profile.findMany.mockResolvedValue([
      { id: 'staff-2', fullName: 'Jamie Jones', role: 'staff', jobTitle: 'Server' },
    ]);

    await expect(controller.listDirectory(staffScope)).resolves.toEqual([
      {
        _id: 'staff-2',
        id: 'staff-2',
        fullName: 'Jamie Jones',
        role: 'staff',
        jobTitle: 'Server',
      },
    ]);
    expect(prisma.profile.findMany).toHaveBeenCalledWith({
      where: { venueId: 'venue-1', id: { not: 'staff-1' }, OR: [{ membershipStatus: null }, { membershipStatus: 'active' }] },
      orderBy: { fullName: 'asc' },
    });
  });

  it('reuses the general chat when it already exists', async () => {
    const { controller, prisma } = makeController();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'general-chat',
      name: 'All Staff',
      memberIds: ['staff-1'],
      isSystem: true,
    });

    await expect(controller.ensureChatSetup(staffScope)).resolves.toEqual({ conversationId: 'general-chat' });
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });

  it('creates the general chat when it does not exist yet', async () => {
    const { controller, prisma } = makeController();
    prisma.conversation.findFirst.mockResolvedValue(null);
    prisma.conversation.create.mockResolvedValue({ id: 'general-created' });

    await expect(controller.ensureChatSetup(staffScope)).resolves.toEqual({ conversationId: 'general-created' });
    expect(prisma.conversation.create).toHaveBeenCalledWith({
      data: {
        venueId: 'venue-1',
        type: 'group',
        name: 'All Staff',
        memberIds: ['staff-1'],
        isSystem: true,
      },
    });
  });

  it('backfills active staff into an existing system chat', async () => {
    const { controller, prisma } = makeController();
    prisma.conversation.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'general-chat',
        name: 'Renamed',
        memberIds: [],
        isSystem: false,
      });
    prisma.profile.findMany.mockResolvedValue([{ id: 'staff-1' }, { id: 'staff-2' }]);

    await expect(controller.ensureChatSetup(staffScope)).resolves.toEqual({ conversationId: 'general-chat' });
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'general-chat' },
      data: { name: 'All Staff', memberIds: ['staff-1', 'staff-2'], isSystem: true },
    });
  });

  it('reuses the system chat created by a concurrent setup request', async () => {
    const { controller, prisma } = makeController();
    prisma.conversation.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'general-winner', memberIds: ['staff-1'], isSystem: true });
    prisma.conversation.create.mockRejectedValue({ code: 'P2002' });

    await expect(controller.ensureChatSetup(staffScope)).resolves.toEqual({ conversationId: 'general-winner' });
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'general-winner' },
      data: { name: 'All Staff', memberIds: ['staff-1'], isSystem: true },
    });
  });

  it('opens an existing dm and rejects messaging yourself', async () => {
    const { controller, prisma } = makeController();

    await expect(controller.openDm(staffScope, { targetProfileId: 'staff-1' })).rejects.toThrow(
      'You cannot start a direct message with yourself',
    );

    prisma.profile.findFirst.mockResolvedValue({ id: 'staff-2', venueId: 'venue-1' });
    prisma.conversation.findFirst.mockResolvedValue({ id: 'existing-dm' });

    await expect(controller.openDm(staffScope, { targetProfileId: 'staff-2' })).resolves.toEqual({
      conversationId: 'existing-dm',
    });
    expect(prisma.profile.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'staff-2',
        venueId: 'venue-1',
        OR: [{ membershipStatus: null }, { membershipStatus: 'active' }],
      },
    });
  });

  it('rejects opening a direct message with an inactive or non-existent profile', async () => {
    const { controller, prisma } = makeController();
    prisma.profile.findFirst.mockResolvedValue(null);

    await expect(controller.openDm(staffScope, { targetProfileId: 'inactive-staff' })).rejects.toThrow(
      'User is not an active member of this venue',
    );
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });

  it('creates a dm when no thread exists yet', async () => {
    const { controller, prisma } = makeController();
    prisma.profile.findFirst.mockResolvedValue({ id: 'staff-2', venueId: 'venue-1' });
    prisma.conversation.findFirst.mockResolvedValue(null);
    prisma.conversation.create.mockResolvedValue({ id: 'new-dm' });

    await expect(controller.openDm(staffScope, { targetProfileId: 'staff-2' })).resolves.toEqual({
      conversationId: 'new-dm',
    });
    expect(prisma.conversation.create).toHaveBeenCalledWith({
      data: {
        venueId: 'venue-1',
        type: 'dm',
        memberIds: ['staff-1', 'staff-2'],
      },
    });
  });

  it('requires a manager to create groups and trims/deduplicates members', async () => {
    const { controller, prisma } = makeController();

    await expect(controller.createGroup(staffScope, { name: 'Crew', memberIds: ['staff-2'] })).rejects.toThrow(
      'Not authorized',
    );
    await expect(controller.createGroup(managerScope, { name: '   ', memberIds: [] })).rejects.toThrow(
      'Enter a group name',
    );

    prisma.conversation.create.mockResolvedValue({ id: 'group-1' });
    prisma.profile.findMany.mockResolvedValue([{ id: 'manager-1' }, { id: 'staff-2' }]);

    await expect(controller.createGroup(managerScope, {
      name: '  Closing Crew  ',
      memberIds: ['staff-2', 'staff-2', 'manager-1'],
    })).resolves.toEqual({ conversationId: 'group-1' });
    expect(prisma.conversation.create).toHaveBeenCalledWith({
      data: {
        venueId: 'venue-1',
        type: 'group',
        name: 'Closing Crew',
        memberIds: ['manager-1', 'staff-2'],
      },
    });
  });

  it('rejects foreign, inactive, or missing profiles from a custom group', async () => {
    const { controller, prisma } = makeController();
    prisma.profile.findMany.mockResolvedValue([{ id: 'manager-1' }]);

    await expect(controller.createGroup(managerScope, {
      name: 'Cross-venue group',
      memberIds: ['foreign-profile'],
    })).rejects.toThrow('All members must be active profiles in this venue');
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });

  it('does not let managers delete direct messages or system conversations', async () => {
    const { controller, prisma } = makeController();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      venueId: 'venue-1',
      type: 'dm',
      name: null,
      memberIds: ['staff-1', 'staff-2'],
      isSystem: false,
    });

    await expect(controller.deleteConversation(managerScope, 'conv-1')).rejects.toThrow(
      'Only custom group chats can be deleted',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('still lets managers delete custom group chats', async () => {
    const { controller, prisma } = makeController();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      venueId: 'venue-1',
      type: 'group',
      name: 'Closing Crew',
      memberIds: ['staff-1', 'staff-2'],
      isSystem: false,
    });

    await expect(controller.deleteConversation(managerScope, 'conv-1')).resolves.toEqual({ ok: true });
    expect(prisma.message.deleteMany).toHaveBeenCalledWith({ where: { conversationId: 'conv-1' } });
    expect(prisma.conversation.delete).toHaveBeenCalledWith({ where: { id: 'conv-1' } });
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('does not allow a renamed system group to be deleted', async () => {
    const { controller, prisma } = makeController();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-system',
      venueId: 'venue-1',
      type: 'group',
      name: 'Renamed by mistake',
      memberIds: ['staff-1'],
      isSystem: true,
    });

    await expect(controller.deleteConversation(managerScope, 'conv-system')).rejects.toThrow(
      'Only custom group chats can be deleted',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('rejects non-participants from reacting to messages', async () => {
    const { controller, prisma } = makeController();
    prisma.message.findFirst.mockResolvedValue({
      id: 'msg-1',
      venueId: 'venue-1',
      conversationId: 'conv-1',
      senderId: 'staff-2',
      reactions: {},
    });
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      venueId: 'venue-1',
      type: 'dm',
      name: null,
      memberIds: ['staff-2', 'staff-3'],
    });

    await expect(controller.toggleReaction(staffScope, 'msg-1', { emoji: 'fire' })).rejects.toThrow('Not a participant');
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it('adds and removes reactions for allowed participants', async () => {
    const { controller, prisma } = makeController();
    prisma.message.findFirst.mockResolvedValueOnce({
      id: 'msg-1',
      venueId: 'venue-1',
      conversationId: 'conv-1',
      senderId: 'staff-2',
      reactions: null,
    }).mockResolvedValueOnce({
      id: 'msg-1',
      venueId: 'venue-1',
      conversationId: 'conv-1',
      senderId: 'staff-2',
      reactions: { fire: ['staff-1'] },
    });
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      venueId: 'venue-1',
      type: 'group',
      name: 'All Staff',
      memberIds: ['staff-1'],
    });

    await expect(controller.toggleReaction(staffScope, 'msg-1', { emoji: 'fire' })).resolves.toEqual({
      ok: true,
      reactions: { fire: ['staff-1'] },
    });
    await expect(controller.toggleReaction(staffScope, 'msg-1', { emoji: 'fire' })).resolves.toEqual({
      ok: true,
      reactions: {},
    });
  });

  it('only lets the sender edit their own message', async () => {
    const { controller, prisma } = makeController();
    prisma.message.findFirst.mockResolvedValue({
      id: 'msg-1',
      venueId: 'venue-1',
      conversationId: 'conv-1',
      senderId: 'staff-2',
      text: 'Original',
    });
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      venueId: 'venue-1',
      type: 'group',
      name: 'Closing Crew',
      memberIds: ['staff-1', 'staff-2'],
    });

    await expect(controller.editMessage(staffScope, 'msg-1', { text: 'Edited' })).rejects.toThrow(
      'Only the sender can edit this message',
    );
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it('updates message text for the sender after trimming', async () => {
    const { controller, prisma } = makeController();
    prisma.message.findFirst.mockResolvedValue({
      id: 'msg-1',
      venueId: 'venue-1',
      conversationId: 'conv-1',
      senderId: 'staff-1',
      text: 'Original',
    });
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      venueId: 'venue-1',
      type: 'group',
      name: 'Closing Crew',
      memberIds: ['staff-1'],
    });

    await expect(controller.editMessage(staffScope, 'msg-1', { text: '  Edited  ' })).resolves.toEqual({
      ok: true,
      text: 'Edited',
    });
    expect(prisma.message.update).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: { text: 'Edited' },
    });
  });

  it('sends a message with a validated chat image and updates conversation preview', async () => {
    const { controller, prisma } = makeController();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      venueId: 'venue-1',
      type: 'group',
      name: 'Closing Crew',
      memberIds: ['staff-1'],
    });
    prisma.chatImage.findUnique.mockResolvedValue({ id: 'img-1', venueId: 'venue-1' });
    prisma.message.create.mockResolvedValue({ id: 'msg-1' });

    await expect(controller.sendMessage(staffScope, 'conv-1', {
      text: '  ',
      imageUrl: '/v1/chat/images/img-1',
    })).resolves.toEqual({ _id: 'msg-1', id: 'msg-1' });

    expect(prisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        conversationId: 'conv-1',
        venueId: 'venue-1',
        senderId: 'staff-1',
        text: '',
        imageUrl: '/v1/chat/images/img-1',
      }),
    }));
    expect(prisma.conversation.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'conv-1' },
      data: expect.objectContaining({
        lastMessageText: expect.stringContaining('Image'),
      }),
    }));
    expect(prisma.$executeRaw).toHaveBeenCalledOnce();
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it('rejects invalid image references when sending messages', async () => {
    const { controller, prisma } = makeController();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      venueId: 'venue-1',
      type: 'group',
      name: 'Closing Crew',
      memberIds: ['staff-1'],
    });

    await expect(controller.sendMessage(staffScope, 'conv-1', {
      text: '',
      imageUrl: '/bad/url',
    })).rejects.toThrow('Invalid image URL format');
  });
  it('rejects empty uploads and returns a signed chat image path for valid uploads', async () => {
    const { controller, prisma, mediaAccess, s3ImageService } = makeController();

    await expect(controller.uploadImage(staffScope, { dataBase64: '', mimeType: 'image/png' })).rejects.toThrow(
      'Image is empty',
    );

    prisma.chatImage.create.mockResolvedValue({ id: 'img-1' });
    s3ImageService.upload.mockResolvedValue('uploads/img-1.png');
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    await expect(controller.uploadImage(staffScope, {
      dataBase64: pngBytes.toString('base64'),
      mimeType: 'image/png',
    })).resolves.toEqual({ imageUrl: 'signed:/v1/chat/images/img-1' });
    expect(mediaAccess.createPath).toHaveBeenCalledWith('chat-image', 'img-1', 'venue-1', '/v1/chat/images/img-1');
  });

  it('removes an uploaded chat image when its database row cannot be created', async () => {
    const { controller, prisma, s3ImageService } = makeController();
    const databaseError = new Error('database unavailable');
    prisma.chatImage.create.mockRejectedValue(databaseError);
    s3ImageService.upload.mockResolvedValue('uploads/orphan.png');
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    await expect(controller.uploadImage(staffScope, {
      dataBase64: pngBytes.toString('base64'),
      mimeType: 'image/png',
    })).rejects.toBe(databaseError);
    expect(s3ImageService.delete).toHaveBeenCalledWith('uploads/orphan.png');
  });

  it('validates chat image access tokens before redirecting to the presigned url', async () => {
    const { controller, prisma, mediaAccess, s3ImageService } = makeController();
    prisma.chatImage.findUnique.mockResolvedValue({
      id: 'img-1',
      venueId: 'venue-1',
      s3Key: 'uploads/img-1.png',
    });
    s3ImageService.getPresignedUrl.mockResolvedValue('https://signed.example/img-1.png');
    const res = { redirect: vi.fn().mockReturnValue('redirected'), setHeader: vi.fn() } as any;

    await expect(controller.getImage('img-1', 'token-1', res)).resolves.toBe('redirected');
    expect(mediaAccess.assertToken).toHaveBeenCalledWith('token-1', 'chat-image', 'img-1', 'venue-1');
    expect(res.redirect).toHaveBeenCalledWith(302, 'https://signed.example/img-1.png');
  });
});
